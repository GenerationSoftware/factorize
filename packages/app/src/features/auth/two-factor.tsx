import { useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import qrCode from "qrcode-generator";
import { api } from "factorize-api-client";
import { Button, Input, Label, Page } from "../../shared/ui";
import { AccountSettingsLayout } from "../settings/navigation";
import { messageOf, refreshIdentity } from "./session";

function CodeInput({ value, setValue, authenticatorOnly = false }: { value: string; setValue: (value: string) => void; authenticatorOnly?: boolean }) {
  return <Label className="block">{authenticatorOnly ? "Authenticator code" : "Authenticator or recovery code"}
    <Input className="mt-1 block w-full" name="code" value={value} onChange={e => setValue(e.target.value)}
      autoComplete="one-time-code" autoCapitalize="none" spellCheck={false}
      inputMode={authenticatorOnly ? "numeric" : "text"} maxLength={authenticatorOnly ? 6 : 64}
      pattern={authenticatorOnly ? "[0-9]{6}" : undefined} required />
  </Label>;
}

export function TwoFactorChallenge() {
  const [code, setCode] = useState("");
  const verify = useMutation({
    retry: false,
    mutationFn: async (code: string) => {
      const { data, error } = await api.POST("/api/v1/auth/two-factor/challenge", { body: { code } });
      if (!data || error) throw new Error(messageOf(error));
      return data.returnTo;
    },
    onSuccess: async target => {
      await refreshIdentity();
      window.location.assign(target);
    },
  });
  function submit(event: FormEvent) { event.preventDefault(); if (!verify.isPending) verify.mutate(code.trim()); }
  return <Page className="my-8 max-w-md flex-none rounded-2xl border border-stone-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
    <h1 className="mb-4 text-2xl font-semibold">Finish signing in</h1>
    <p className="mb-4">Enter a code from your authenticator app or use one of your recovery codes.</p>
    <form className="space-y-4" onSubmit={submit}>
      <CodeInput value={code} setValue={setCode} />
      {verify.error && <p role="alert">{verify.error.message}</p>}
      <Button type="submit" variant="primary" disabled={verify.isPending}>Verify code</Button>
    </form>
    <p className="mt-4"><Link to="/auth/login">Back to sign in</Link></p>
  </Page>;
}

function SetupQr({ uri }: { uri: string }) {
  const { width, path } = useMemo(() => {
    const matrix = qrCode(0, "M");
    matrix.addData(uri);
    matrix.make();
    const size = matrix.getModuleCount(), dark: string[] = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (matrix.isDark(y, x)) dark.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    }
    return { width: size + 8, path: dark.join("") };
  }, [uri]);
  return <svg role="img" aria-label="Authenticator setup QR code" className="h-56 w-56 max-w-full"
    viewBox={`0 0 ${width} ${width}`} shapeRendering="crispEdges">
    <rect width={width} height={width} fill="white" /><path d={path} fill="black" />
  </svg>;
}

export function TwoFactorSettings() {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const status = useQuery({
    queryKey: ["two-factor-settings"], retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/auth/two-factor", { signal });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
  });
  const google = useMutation({
    retry: false,
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/two-factor/google");
      if (!data || error) throw new Error(messageOf(error));
      return data.authorizationUrl;
    }, onSuccess: url => window.location.assign(url),
  });
  const start = useMutation({
    retry: false, gcTime: 0,
    mutationFn: async (password: string | undefined) => {
      const { data, error } = await api.POST("/api/v1/auth/two-factor/enrollment", { body: { password } });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    }, onSuccess: data => { setSetup(data); setPassword(""); },
  });
  const enable = useMutation({
    retry: false, gcTime: 0,
    mutationFn: async (code: string) => {
      const { data, error } = await api.POST("/api/v1/auth/two-factor/enable", { body: { code } });
      if (!data || error) throw new Error(messageOf(error));
      return data.recoveryCodes;
    }, onSuccess: async recovery => {
      setCodes(recovery);
      setCode("");
      setSetup(null);
      await refreshIdentity();
      await status.refetch();
    },
  });
  const disable = useMutation({
    retry: false,
    mutationFn: async (body: { password?: string; code: string }) => {
      const { data, error } = await api.POST("/api/v1/auth/two-factor/disable", { body });
      if (!data || error) throw new Error(messageOf(error));
    }, onSuccess: async () => {
      setPassword("");
      setCode("");
      await refreshIdentity();
      await status.refetch();
    },
  });

  const state = status.data;
  const passwordInput = state?.method === "password";
  const needsGoogle = state?.method === "google" && !state.googleVerified;
  const busy = google.isPending || start.isPending || enable.isPending || disable.isPending;
  const error = google.error ?? start.error ?? enable.error ?? disable.error;
  return <AccountSettingsLayout title="Two-factor authentication">
    {status.isPending && !codes.length && <p role="status">Loading two-factor settings…</p>}
    {status.error && <p role="alert">{status.error.message}</p>}
    {error && <p role="alert">{error.message}</p>}
    {codes.length > 0 ? <section className="space-y-3">
      <h2>Save your recovery codes</h2>
      <p>Two-factor authentication is on. Store these codes somewhere safe. Each code works once and will not be shown again.</p>
      <ul className="grid gap-1 font-mono sm:grid-cols-2">{codes.map(value => <li key={value}>{value}</li>)}</ul>
      <Button type="button" onClick={() => { setCodes([]); enable.reset(); }}>I saved my codes</Button>
    </section> : setup ? <form className="max-w-md space-y-4" onSubmit={event => { event.preventDefault(); if (!busy) enable.mutate(code.trim()); }}>
      <p>Scan this QR code in an authenticator app, then enter the six-digit code. If you can’t scan, enter the setup key manually.</p>
      <SetupQr uri={setup.uri} />
      <p>Setup key: <code className="break-all">{setup.secret}</code></p>
      <CodeInput value={code} setValue={setCode} authenticatorOnly />
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={busy}>Enable two-factor authentication</Button>
        <Button type="button" disabled={busy} onClick={() => { setSetup(null); setCode(""); enable.reset(); start.reset(); }}>Cancel</Button></div>
    </form> : state && <section className="max-w-md space-y-4">
      <p>Two-factor authentication is {state.enabled ? "on" : "off"}.</p>
      {!state.available && !state.enabled ? <p>Authenticator setup is not available on this deployment.</p>
        : state.method === "unavailable" ? <p>A Factorize password or linked Google account is needed to change this setting.</p>
        : needsGoogle ? <>
          <p>Confirm your linked Google account before changing this setting.</p>
          <Button type="button" disabled={busy} onClick={() => google.mutate()}>Confirm with Google</Button>
        </> : <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          if (busy) return;
          const primary = passwordInput ? password : undefined;
          if (state.enabled) disable.mutate({ password: primary, code: code.trim() });
          else start.mutate(primary);
        }}>
          {passwordInput && <Label className="block">Current password
            <Input className="mt-1 block w-full" type="password" autoComplete="current-password" value={password}
              onChange={e => setPassword(e.target.value)} minLength={12} maxLength={200} required />
          </Label>}
          {state.enabled && <CodeInput value={code} setValue={setCode} />}
          <Button type="submit" variant="primary" disabled={busy}>{state.enabled ? "Disable two-factor authentication" : "Set up authenticator"}</Button>
        </form>}
    </section>}
  </AccountSettingsLayout>;
}
