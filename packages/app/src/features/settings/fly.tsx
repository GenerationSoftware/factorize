import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label, Select } from "../../shared/ui";
import { messageOf } from "../auth/session";

export const flyConnectionQuery = { queryKey: ["settings", "fly"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/fly/connection", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data.connection;
} };
export const flyConfigurationsQuery = { queryKey: ["editor", "fly-configurations"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/fly/execution-configurations", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data.configurations;
} };
export function FlyIntegration() {
  const cache = useQueryClient(), connection = useQuery(flyConnectionQuery);
  const [token, setToken] = useState(""), [organizationSlug, setOrganizationSlug] = useState("");
  const action = useMutation({ retry: false, mutationFn: async (kind: "verify" | "save" | "disconnect") => {
    const body = { token, organizationSlug: organizationSlug || connection.data?.organizationSlug || "" };
    const result = kind === "verify" ? await api.POST("/api/v1/fly/connection/test", { body }) : kind === "save" ? await api.PUT("/api/v1/fly/connection", { body }) : await api.DELETE("/api/v1/fly/connection");
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return kind;
  }, onSuccess: async kind => { if (kind !== "verify") { setToken(""); await cache.invalidateQueries({ queryKey: ["settings", "fly"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } } });
  return <section aria-label="Fly.io integration" className="mt-6"><Card><h2>Fly.io</h2><p>Run jobs on Fly Machines in your organization.</p>
    {connection.isPending && <p role="status">Loading Fly.io connection…</p>}
    {connection.data && <p>Connected to {connection.data.organizationName} ({connection.data.organizationSlug})</p>}
    <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); action.mutate("save"); }}>
      <Label>Fly organization slug <Input required disabled={action.isPending} value={organizationSlug || connection.data?.organizationSlug || ""} onChange={event => { setOrganizationSlug(event.target.value); action.reset(); }} /></Label>
      <Label>Fly organization token <Input required disabled={action.isPending} type="password" autoComplete="new-password" value={token} onChange={event => { setToken(event.target.value); action.reset(); }} /></Label>
      <p className="text-sm">Use an organization deploy token with Machines permissions. Enter the token to verify or replace the connection. Verification checks credentials without launching a VM.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={!token.trim() || action.isPending} onClick={() => action.mutate("verify")}>{action.isPending && action.variables === "verify" ? "Verifying…" : "Verify connection"}</Button><Button disabled={action.isPending}>Save Fly.io integration</Button>{connection.data && <Button type="button" variant="destructive" disabled={action.isPending} onClick={() => { if (window.confirm("Disconnect Fly.io? Jobs using this connection will no longer run.")) action.mutate("disconnect"); }}>Disconnect Fly.io</Button>}</div>
    </form>
    {action.isSuccess && <p role="status">{action.data === "verify" ? "Fly.io connection verified." : action.data === "save" ? "Fly.io integration saved." : "Fly.io disconnected."}</p>}
    {[connection.error, action.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{error?.message}</p>)}
  </Card></section>;
}

type Configuration = { name: string; image: string; region: string; size: string };
export function FlyExecutionFields({ initial, onDirty, onSaved }: { initial?: Configuration; onDirty: () => void; onSaved: (id: string) => void }) {
  const cache = useQueryClient();
  const [value, setValue] = useState<Configuration>(initial ?? { name: "", image: "", region: "iad", size: "shared-cpu-1x" });
  const save = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/fly/execution-configurations", { body: value });
    if (!data || error) throw new Error(messageOf(error)); return data.configuration;
  }, onSuccess: async configuration => { await cache.invalidateQueries({ queryKey: flyConfigurationsQuery.queryKey }); onSaved(configuration.id); } });
  const change = (next: Configuration) => { onDirty(); setValue(next); save.reset(); };
  return <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2" role="group" aria-label="Fly.io VM configuration">
    <Label>Execution configuration name <Input disabled={save.isPending} value={value.name} maxLength={120} onChange={e => change({ ...value, name: e.target.value })} /></Label>
    <Label>Fly VM image <Input disabled={save.isPending} value={value.image} maxLength={512} placeholder="ghcr.io/your-org/runner:tag" onChange={e => change({ ...value, image: e.target.value })} /></Label>
    <Label>Fly region <Select disabled={save.isPending} value={value.region} onChange={e => change({ ...value, region: e.target.value })}>{["iad", "ord", "sjc", "lax", "ams", "fra", "lhr", "nrt", "sin"].map(region => <option key={region}>{region}</option>)}</Select></Label>
    <Label>Fly VM size <Select disabled={save.isPending} value={value.size} onChange={e => change({ ...value, size: e.target.value })}>{["shared-cpu-1x", "shared-cpu-2x", "shared-cpu-4x", "performance-1x", "performance-2x", "performance-4x"].map(size => <option key={size}>{size}</option>)}</Select></Label>
    <p className="text-sm sm:col-span-2">Save these settings as an execution configuration, then create or save the job. Changes create a new configuration so other jobs keep their settings. Use a public image with the prerequisites for your script or Codex agent.</p>
    <Button type="button" disabled={save.isPending || !value.name.trim() || !value.image.trim()} onClick={() => save.mutate()}>Save Fly VM settings</Button>
    {save.error && <p role="alert">{save.error.message}</p>}
  </div>;
}
