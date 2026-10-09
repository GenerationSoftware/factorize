import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { api } from "factorize-api-client";
import { messageOf, refreshIdentity } from "./session";

export type AuthMode = "login" | "signup" | "reset" | "verify" | "verify-request" | "password";
const titles: Record<AuthMode, string> = {
  login: "Sign in to Factorize", signup: "Create your Factorize account", reset: "Reset password",
  verify: "Verify your email", "verify-request": "Resend verification email", password: "Change password",
};
export function AuthScreen({ mode }: { mode: AuthMode }) {
  const search = useSearch({ strict: false }) as { token?: string; returnTo?: string };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [notice, setNotice] = useState("");
  const resetCompletion = mode === "reset" && Boolean(search.token);
  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      let result;
      switch (mode) {
        case "login": result = await api.POST("/api/v1/auth/login", { body: { email, password, returnTo: search.returnTo } }); break;
        case "signup": result = await api.POST("/api/v1/auth/signup", { body: { email, password } }); break;
        case "reset": result = resetCompletion
          ? await api.POST("/api/v1/auth/password-reset/complete", { body: { token: search.token!, password } })
          : await api.POST("/api/v1/auth/password-reset/request", { body: { email } }); break;
        case "verify": result = await api.POST("/api/v1/auth/email-verification/complete", { body: { token: search.token ?? "" } }); break;
        case "verify-request": result = await api.POST("/api/v1/auth/email-verification/request", { body: { email } }); break;
        case "password": result = await api.POST("/api/v1/auth/password", { body: { currentPassword, password } }); break;
      }
      if (result.error || !result.data) throw new Error(messageOf(result.error));
      return result.data;
    },
    onSuccess: async data => {
      setPassword(""); setCurrentPassword("");
      if (mode === "login") {
        await refreshIdentity();
        if ("returnTo" in data && typeof data.returnTo === "string") window.location.assign(data.returnTo);
      } else if (mode === "password" || resetCompletion) {
        await refreshIdentity();
        setNotice("Password updated. Sign in with your new password.");
      } else if (mode === "verify") {
        setNotice("Your email is verified. You can now sign in.");
      } else {
        setNotice("If this email can receive the requested link, check your inbox for the next step.");
      }
    },
  });
  function submit(event: FormEvent) { event.preventDefault(); setNotice(""); mutation.mutate(); }
  const showEmail = mode !== "password" && mode !== "verify" && !resetCompletion;
  const showPassword = mode === "login" || mode === "signup" || mode === "password" || resetCompletion;
  return (
    <main className="mx-auto max-w-md p-6">
      <Link to="/" className="text-lg font-semibold">Factorize</Link>
      <h1 className="my-6 text-2xl font-semibold">{titles[mode]}</h1>
      <form onSubmit={submit} className="space-y-4" aria-busy={mutation.isPending}>
        {showEmail && <label className="block">Email<input className="mt-1 block w-full rounded border p-2" name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={320} /></label>}
        {mode === "password" && <label className="block">Current password<input className="mt-1 block w-full rounded border p-2" name="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required minLength={12} maxLength={200} /></label>}
        {showPassword && <><label className="block">{mode === "login" ? "Password" : "New password"}<input className="mt-1 block w-full rounded border p-2" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={200} aria-describedby={mode !== "login" ? "password-rules" : undefined} /></label>{mode !== "login" && <p id="password-rules" className="text-sm">Use 12–200 characters.</p>}</>}
        {mode === "verify" && !search.token ? <p role="alert">This link has no verification token. Request a new email below.</p> : <button className="rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-50" disabled={mutation.isPending}>{mutation.isPending ? "Please wait…" : mode === "login" ? "Sign in" : mode === "verify" ? "Verify email" : "Continue"}</button>}
        {mutation.isError && <p role="alert">{mutation.error.message}</p>}
        {notice && <p role="status">{notice}</p>}
      </form>
      <nav className="mt-6 flex flex-wrap gap-4" aria-label="Account">
        {mode !== "login" && <Link to="/auth/login">Sign in</Link>}
        {mode === "login" && <><Link to="/auth/signup">Create an account</Link><Link to="/auth/password-reset">Forgot password?</Link></>}
        <Link to="/auth/verify/request">Resend verification</Link>
      </nav>
    </main>
  );
}
