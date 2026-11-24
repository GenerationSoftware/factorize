import { useState, type FormEvent } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type paths } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { SettingsLayout } from "../settings/navigation";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";
import { tabClasses } from "../auth/team-navigation";

type AppRegistration = paths["/api/v1/apps"]["get"]["responses"][200]["content"]["application/json"][number];
const registeredKey = ["apps", "registered"];
const connectedKey = ["apps", "connected"];

function AppNavigation() {
  const registered = useLocation().pathname === "/apps/registered";
  return <nav aria-label="Apps" className="mb-4 border-b border-stone-200 dark:border-slate-800">
    <Link className={tabClasses(!registered)} aria-current={registered ? undefined : "page"} to="/apps">Connected apps</Link>
    <Link className={tabClasses(registered)} aria-current={registered ? "page" : undefined} to="/apps/registered">Registered apps</Link>
  </nav>;
}

export function ConnectedAppsPage() {
  const cache = useQueryClient();
  const connected = useQuery({
    queryKey: connectedKey, queryFn: async ({ signal }) => {
      const { error, data } = await api.GET("/api/v1/app-connections", { signal });
      if (error) throw new Error(messageOf(error));
      return data ?? [];
    },
  });
  const revoke = useMutation({
    mutationFn: async (connectionId: string) => {
      const { error } = await api.DELETE("/api/v1/app-connections/{connectionId}", { params: { path: { connectionId } } });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: connectedKey }),
  });
  return <SettingsLayout title="Apps"><AppNavigation />
    {connected.isPending && <p role="status">Loading connected apps…</p>}
    {connected.error && <p role="alert">{connected.error.message}</p>}
    {revoke.error && <p role="alert">{revoke.error.message}</p>}
    {connected.data?.length === 0 && <p>No connected apps.</p>}
    <ul className="divide-y divide-stone-200 dark:divide-slate-800">{connected.data?.map(app =>
      <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={app.id}>
        <div><strong>{app.name}</strong><p className="text-sm">{app.scopes.join(", ")}</p></div>
        <Button disabled={revoke.isPending} onClick={() => {
          if (window.confirm(`Revoke access for ${app.name}?`)) revoke.mutate(app.id);
        }}>Revoke connection</Button>
      </li>
    )}</ul>
  </SettingsLayout>;
}

function RegistrationEditor({ app, close }: { app: AppRegistration | null; close: () => void }) {
  const cache = useQueryClient();
  const [name, setName] = useState(app?.name ?? "");
  const [redirects, setRedirects] = useState(app?.redirectUris.join("\n") ?? "");
  const [isPublic, setIsPublic] = useState(app?.public ?? false);
  const [enabled, setEnabled] = useState(app?.enabled ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const body = { name, redirectUris: redirects.split("\n").map(value => value.trim()).filter(Boolean), public: isPublic };
      const { error } = app
        ? await api.PUT("/api/v1/apps/{appId}", { params: { path: { appId: app.id } }, body: { ...body, enabled } })
        : await api.POST("/api/v1/apps", { body });
      if (error) throw new Error(messageOf(error));
    },
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: registeredKey }), cache.invalidateQueries({ queryKey: connectedKey })]);
      close();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); save.mutate(); }
  return <Dialog title={app ? "Edit app" : "Register app"} close={close}>
    <form className="grid gap-3" onSubmit={submit}>
      <Label>App name<Input value={name} onChange={event => setName(event.target.value)} required maxLength={100} /></Label>
      <Label>Redirect URLs <span className="text-sm">One URL per line</span>
        <textarea className="block w-full rounded border p-2 dark:bg-slate-950" rows={3} required value={redirects} onChange={event => setRedirects(event.target.value)} />
      </Label>
      <Label className="flex items-center gap-2"><Input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} />Available to everyone</Label>
      {app && <Label className="flex items-center gap-2"><Input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Enabled</Label>}
      {save.error && <p role="alert">{save.error.message}</p>}
      <Button type="submit" variant="primary" disabled={save.isPending}>{app ? "Save app" : "Register app"}</Button>
    </form>
  </Dialog>;
}

export function RegisteredAppsPage() {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<AppRegistration | null | undefined>();
  const [issued, setIssued] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const registered = useQuery({
    queryKey: registeredKey, queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/apps", { signal });
      if (error) throw new Error(messageOf(error));
      return data ?? [];
    },
  });
  const secret = useMutation({
    mutationFn: async (appId: string) => {
      const { data, error } = await api.POST("/api/v1/apps/{appId}/secret", { params: { path: { appId } } });
      if (!data || error) throw new Error(messageOf(error));
      setIssued(data);
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: registeredKey }),
  });
  return <SettingsLayout title="Apps"><AppNavigation />
    <Button variant="primary" onClick={() => setEditing(null)}>Register app</Button>
    {registered.isPending && <p role="status">Loading registered apps…</p>}
    {registered.error && <p role="alert">{registered.error.message}</p>}
    {secret.error && <p role="alert">{secret.error.message}</p>}
    {registered.data?.length === 0 && <p className="mt-4">No registered apps.</p>}
    <ul className="mt-4 divide-y divide-stone-200 dark:divide-slate-800">{registered.data?.map(app =>
      <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={app.id}>
        <div><strong>{app.name}</strong><p className="text-sm">{app.enabled ? app.public ? "Available to everyone" : "Team only" : "Disabled"}</p><code className="break-all text-xs">{app.id}</code></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(app)}>Edit app</Button>
          <Button disabled={secret.isPending} onClick={() => {
            if (!app.secretConfigured || window.confirm(`Rotate the client secret for ${app.name}?`)) secret.mutate(app.id);
          }}>{app.secretConfigured ? "Rotate client secret" : "Create client secret"}</Button>
        </div>
      </li>
    )}</ul>
    {editing !== undefined && <RegistrationEditor app={editing} close={() => setEditing(undefined)} />}
    {issued && <Dialog title="Client secret" close={() => setIssued(null)}>
      <p className="mb-3">Copy this secret now. It is shown once.</p>
      <Label>Client ID<Input readOnly value={issued.clientId} /></Label>
      <Label>Client secret<Input readOnly value={issued.clientSecret} /></Label>
      <Button onClick={() => setIssued(null)}>Done</Button>
    </Dialog>}
  </SettingsLayout>;
}
