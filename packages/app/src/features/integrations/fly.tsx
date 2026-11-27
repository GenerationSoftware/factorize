import type { StartIntegrationRemoval } from "./integration-removal";
import { SecretInput } from "../../shared/credential-fields";
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
export function useFlyIntegration(remove: StartIntegrationRemoval, removalBusy: boolean) {
  const cache = useQueryClient(), connection = useQuery(flyConnectionQuery);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(""), [organizationSlug, setOrganizationSlug] = useState("");
  const action = useMutation({ retry: false, mutationFn: async (kind: "verify" | "save") => {
    const body = { token, organizationSlug: organizationSlug || connection.data?.organizationSlug || "" };
    const result = kind === "verify" ? await api.POST("/api/v1/fly/connection/test", { body }) : await api.PUT("/api/v1/fly/connection", { body });
    if (!result.data || result.error) throw new Error(messageOf(result.error));
    return kind;
  }, onSuccess: async kind => { if (kind !== "verify") { setToken(""); setOpen(false); await cache.invalidateQueries({ queryKey: ["settings"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } } });
  const close = () => {setToken(""); setOrganizationSlug(""); setOpen(false); action.reset();};
  return {
    count: connection.data ? 1 : 0, pending: connection.isPending,
    rows: connection.data ? [<IntegrationRow key="fly" kind="fly" credentialId="fly" name="Fly.io" detail={`${connection.data.organizationName} (${connection.data.organizationSlug})`} actions={[
      {label: "Edit / verify connection", onClick: () => {action.reset(); setOpen(true);}},
      {label: "Delete", destructive: true, disabled: action.isPending || removalBusy, onClick: () => remove({ kind: "fly", id: "fly", name: "Fly.io" })},
    ]} />] : [],
    tile: <ProviderTile kind="fly" name="Fly.io" description="Connect the Fly Machines API for MCP clients." count={connection.data ? 1 : 0} onAdd={() => {action.reset(); setOpen(true);}} />,
    feedback: <>{connection.error && <p role="alert">{connection.error.message}</p>}{!open && action.error && <p role="alert">{action.error.message}</p>}{!open && action.isSuccess && action.data === "save" && <p role="status">Fly.io integration saved.</p>}</>,
    dialog: open && <Dialog title={connection.data ? "Edit Fly.io integration" : "Add Fly.io integration"} close={close}>
      <form autoComplete="off" method="post" className="mt-4 grid gap-3" onSubmit={event => {event.preventDefault(); action.mutate("save");}}>
        <Label>Fly organization slug <Input required disabled={action.isPending} value={organizationSlug || connection.data?.organizationSlug || ""} onChange={event => {setOrganizationSlug(event.target.value); action.reset();}} /></Label>
        <Label>Fly organization token <SecretInput name="fly-organization-token" required disabled={action.isPending} value={token} onChange={event => {setToken(event.target.value); action.reset();}} /></Label>
        <p className="text-sm">Use an organization deploy token with Machines permissions. Enter the token to verify or replace the connection. Verification checks credentials without launching a VM.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={!token.trim() || action.isPending} onClick={() => action.mutate("verify")}>{action.isPending && action.variables === "verify" ? "Verifying…" : "Verify connection"}</Button><Button disabled={action.isPending || connection.isPending || Boolean(connection.error)}>Save Fly.io integration</Button><Button type="button" onClick={close}>Cancel</Button></div>
      </form>
      {action.isSuccess && action.data === "verify" && <p role="status">Fly.io connection verified.</p>}{action.error && <p role="alert">{action.error.message}</p>}
    </Dialog>,
  };
}
