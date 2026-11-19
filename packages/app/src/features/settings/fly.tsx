import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label, Select } from "../../shared/ui";
import { messageOf } from "../auth/session";

import { Dialog } from "../../shared/dialog";
import { IntegrationRow, ProviderTile } from "./integration-ui";

export const flyConnectionQuery = { queryKey: ["settings", "fly"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/fly/connection", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data.connection;
} };
export const flyConfigurationsQuery = { queryKey: ["editor", "fly-configurations"], queryFn: async ({ signal }: { signal: AbortSignal }) => {
  const { data, error } = await api.GET("/api/v1/fly/execution-configurations", { signal });
  if (!data || error) throw new Error(messageOf(error)); return data.configurations;
} };
export function useFlyIntegration() {
  const cache = useQueryClient(), connection = useQuery(flyConnectionQuery);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(""), [organizationSlug, setOrganizationSlug] = useState("");
  const action = useMutation({ retry: false, mutationFn: async (kind: "verify" | "save" | "disconnect") => {
    const body = { token, organizationSlug: organizationSlug || connection.data?.organizationSlug || "" };
    const result = kind === "verify" ? await api.POST("/api/v1/fly/connection/test", { body }) : kind === "save" ? await api.PUT("/api/v1/fly/connection", { body }) : await api.DELETE("/api/v1/fly/connection");
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return kind;
  }, onSuccess: async kind => { if (kind !== "verify") { setToken(""); setOpen(false); await cache.invalidateQueries({ queryKey: ["settings"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } } });
  const close = () => {setToken(""); setOrganizationSlug(""); setOpen(false); action.reset();};
  return {
    count: connection.data ? 1 : 0, pending: connection.isPending,
    rows: connection.data ? [<IntegrationRow key="fly" kind="fly" credentialId="fly" name="Fly.io" detail={`${connection.data.organizationName} (${connection.data.organizationSlug})`} actions={[
      {label: "Edit / verify connection", onClick: () => {action.reset(); setOpen(true);}},
      {label: "Disconnect", destructive: true, disabled: action.isPending, onClick: () => {if (window.confirm("Disconnect Fly.io? Jobs using this connection will no longer run.")) action.mutate("disconnect");}},
    ]} />] : [],
    tile: <ProviderTile kind="fly" name="Fly.io" description="Run jobs on Fly Machines in your organization." count={connection.data ? 1 : 0} onAdd={() => {action.reset(); setOpen(true);}} />,
    feedback: <>{connection.error && <p role="alert">{connection.error.message}</p>}{!open && action.error && <p role="alert">{action.error.message}</p>}{!open && action.isSuccess && <p role="status">{action.data === "save" ? "Fly.io integration saved." : "Fly.io disconnected."}</p>}</>,
    dialog: open && <Dialog title={connection.data ? "Edit Fly.io integration" : "Add Fly.io integration"} close={close}>
      <form className="mt-4 grid gap-3" onSubmit={event => {event.preventDefault(); action.mutate("save");}}>
        <Label>Fly organization slug <Input required disabled={action.isPending} value={organizationSlug || connection.data?.organizationSlug || ""} onChange={event => {setOrganizationSlug(event.target.value); action.reset();}} /></Label>
        <Label>Fly organization token <Input required disabled={action.isPending} type="password" autoComplete="new-password" value={token} onChange={event => {setToken(event.target.value); action.reset();}} /></Label>
        <p className="text-sm">Use an organization deploy token with Machines permissions. Enter the token to verify or replace the connection. Verification checks credentials without launching a VM.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={!token.trim() || action.isPending} onClick={() => action.mutate("verify")}>{action.isPending && action.variables === "verify" ? "Verifying…" : "Verify connection"}</Button><Button disabled={action.isPending || connection.isPending || Boolean(connection.error)}>Save Fly.io integration</Button><Button type="button" onClick={close}>Cancel</Button></div>
      </form>
      {action.isSuccess && action.data === "verify" && <p role="status">Fly.io connection verified.</p>}{action.error && <p role="alert">{action.error.message}</p>}
    </Dialog>,
  };
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
