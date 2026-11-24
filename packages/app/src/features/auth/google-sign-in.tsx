import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label, Page } from "../../shared/ui";
import { messageOf, refreshIdentity } from "./session";

export function GoogleSignInButton({ connection, returnTo }: { connection?: string; returnTo?: string }) {
  const availability = useQuery({
    queryKey: ["google-sign-in"], retry: false, staleTime: 60_000,
    queryFn: async ({ signal }) => (await api.GET("/api/v1/auth/google", { signal })).data?.enabled === true,
  });
  const start = useMutation({
    retry: false,
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/google/start", { body: { connection, returnTo } });
      if (!data || error) throw new Error(messageOf(error));
      return data.authorizationUrl;
    },
    onSuccess: url => window.location.assign(url),
  });
  if (!availability.data) return null;
  return <div className="mb-4">
    <Button type="button" className="w-full" disabled={start.isPending} onClick={() => start.mutate()}>Sign in with Google</Button>
    {start.error && <p role="alert">{start.error.message}</p>}
  </div>;
}

const validUsername = (text: string) => text.length >= 3 && text.length <= 39 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(text);
export function GoogleSignInScreen() {
  const { token } = useSearch({ from: "/auth/google" });
  const navigate = useNavigate();
  const sendEmail = useMutation({
    retry: false,
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/google/email/request");
      if (!data || error) throw new Error(messageOf(error));
    },
  });
  const verifyEmail = useMutation({
    retry: false,
    mutationFn: async (token: string) => {
      const { data, error } = await api.POST("/api/v1/auth/google/email/verify", { body: { token } });
      if (!data || error) throw new Error(messageOf(error));
    },
    onSuccess: async () => {
      await navigate({ to: "/auth/google", search: {}, replace: true });
      await pending.refetch();
    },
  });
  const [newPassword, setNewPassword] = useState("");
  const completePassword = useMutation({
    retry: false,
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/google/password/complete", { body: { token: token!, password: newPassword } });
      if (!data || error) throw new Error(messageOf(error));
      return data.returnTo;
    },
    onSuccess: async target => {
      await refreshIdentity();
      window.location.assign(target);
    },
  });
  const [username, setUsername] = useState("");
  const [confirmedName, setConfirmedName] = useState("");
  const [password, setPassword] = useState("");
  const proposedName = username.trim();
  const pending = useQuery({
    queryKey: ["google-sign-in", "pending"], retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/auth/google/pending", { signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  useEffect(() => {
    const timer = setTimeout(() => setConfirmedName(proposedName), 350);
    return () => clearTimeout(timer);
  }, [proposedName]);
  const checkingName = pending.data?.mode === "signup" && confirmedName === proposedName && validUsername(confirmedName);
  const availability = useQuery({
    queryKey: ["google-sign-in", "username", confirmedName], retry: false, enabled: checkingName,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.POST("/api/v1/auth/google/username", { signal, body: { username: confirmedName } });
      if (!data || error) throw new Error(messageOf(error));
      return data.available;
    },
  });
  const finish = useMutation({
    retry: false,
    mutationFn: async () => {
      const body = pending.data?.mode === "signup" ? { username: proposedName } : { password };
      const { data, error } = await api.POST("/api/v1/auth/google/finish", { body });
      if (!data || error) throw new Error(messageOf(error));
      return data.returnTo;
    },
    onSuccess: async target => {
      await refreshIdentity();
      window.location.assign(target);
    },
  });
  const signup = pending.data?.mode === "signup";
  const canSubmit = !!pending.data && pending.data.mode !== "verify-email" && pending.data.mode !== "set-password" && !finish.isPending && (!signup || (validUsername(proposedName) && !(checkingName && availability.data === false)));
  function submit(event: FormEvent) { event.preventDefault(); if (canSubmit) finish.mutate(); }
  const settingPassword = pending.data?.mode === "set-password";
  const requiresEmail = pending.data?.mode === "verify-email" || settingPassword;
  return <Page className="my-8 flex-none max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
    <h1 className="mb-4 text-2xl font-semibold">{settingPassword && token ? "Set your Factorize password" : token || requiresEmail ? "Confirm your email" : signup ? "Choose your Factorize username" : pending.data ? "Connect Google to Factorize" : "Sign in with Google"}</h1>
    {pending.isPending && <p role="status">Checking your Google sign-in…</p>}
    {pending.error && !token && <p role="alert">{pending.error.message}</p>}
    {token && pending.isPending ? null : token && settingPassword ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!completePassword.isPending) completePassword.mutate(); }}>
      <Label className="block">New password<Input className="mt-1 block w-full" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required /></Label>
      <p>Use 12–200 characters.</p>
      <Button type="submit" variant="primary" disabled={completePassword.isPending}>Save password</Button>
      {completePassword.error && <p role="alert">{completePassword.error.message}</p>}
    </form> : token ? <div className="space-y-4">
      <p>Confirm this address to continue Google signup. Open this link in the browser where you started.</p>
      <Button type="button" variant="primary" disabled={verifyEmail.isPending} onClick={() => verifyEmail.mutate(token)}>Confirm email</Button>
      {verifyEmail.error && <p role="alert">{verifyEmail.error.message}</p>}
    </div> : requiresEmail ? <div className="space-y-4">
      <p>We’ll send a confirmation link to {pending.data!.email}. Open it in this browser to {settingPassword ? "set your password" : "finish signing up"}.</p>
      <Button type="button" variant="primary" disabled={sendEmail.isPending} onClick={() => sendEmail.mutate()}>{sendEmail.isSuccess ? "Resend confirmation" : "Email me a confirmation link"}</Button>
      {sendEmail.isSuccess && <p role="status">Check your email for the confirmation link.</p>}
      {sendEmail.error && <p role="alert">{sendEmail.error.message}</p>}
    </div> : pending.data && <form className="space-y-4" onSubmit={submit}>
      <p>{signup ? "Your account will use" : "Confirm the existing Factorize password for"} {pending.data.email}.</p>
      {signup ? <>
        <Label className="block">Username<Input className="mt-1 block w-full" value={username} onChange={event => { setUsername(event.target.value.toLowerCase()); finish.reset(); }} autoComplete="username" minLength={3} maxLength={39} required disabled={finish.isPending} /></Label>
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {checkingName && !finish.error && (availability.isFetching ? "Checking username…" : availability.data === true
            ? <span className="text-green-700 dark:text-green-400"><span aria-hidden="true">✓ </span>Username available</span>
            : availability.data === false ? "That username is already taken." : availability.error ? "Could not check now. Availability will be checked when you continue." : null)}
        </p>
      </> : <>
        <Label className="block">Factorize password<Input className="mt-1 block w-full" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" minLength={12} maxLength={200} required disabled={finish.isPending} /></Label>
        <Link to="/auth/password-reset">Forgot password?</Link>
      </>}
      {finish.error && <p role="alert">{finish.error.message}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>{finish.isPending ? "Please wait…" : signup ? "Create account" : "Connect and sign in"}</Button>
    </form>}
    <p className="mt-4"><Link to="/auth/login">Back to sign in</Link></p>
  </Page>;
}
