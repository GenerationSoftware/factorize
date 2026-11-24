import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Label } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";
import { IntegrationRow, ProviderTile } from "./integration-ui";

const paths = {
  status: "/api/v1/integrations/cloudflare",
  authorize: "/api/v1/integrations/cloudflare/authorize",
  select: "/api/v1/integrations/cloudflare/select",
  connection: "/api/v1/integrations/cloudflare/{connectionId}",
} as const;
const key = ["settings", "cloudflare-rest"];
export function useCloudflareIntegration() {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [writes, setWrites] = useState(false);
  const [accountId, setAccountId] = useState("");
  const result = new URLSearchParams(window.location.search).get("cloudflare");
  const status = useQuery({ queryKey: key, retry: false, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(paths.status, { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }});
  const authorize = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.POST(paths.authorize, { body: { enableWrites: writes } });
    if (!data || error) throw new Error(messageOf(error));
    return data.authorizationUrl;
  }, onSuccess: url => window.location.assign(url) });
  const select = useMutation({ retry: false, mutationFn: async (accountId: string) => {
    const { error } = await api.POST(paths.select, { body: { accountId } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: async () => {
    window.history.replaceState(window.history.state, "", "/integrations");
    setAccountId("");
    await cache.invalidateQueries({ queryKey: ["settings"] });
  }});
  const disconnect = useMutation({ retry: false, mutationFn: async (id: string) => {
    const { error } = await api.DELETE(paths.connection, { params: { path: { connectionId: id } } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ["settings"] }) });
  const data = status.data;
  const connections = data?.connections?.filter(row => row.connected) ?? [];
  const start = () => { setWrites(false); authorize.reset(); setOpen(true); };
  const accounts = data?.accounts ?? [];
  const feedback = <>
    {(result === "failed" || result === "expired" || result === "denied") && <p role="alert">Cloudflare did not complete authorization. Start a new connection when you’re ready.</p>}
    {result === "select" && !accounts.length && !status.isPending && !select.isSuccess && <p role="alert">The Cloudflare account selection expired. Start a new connection.</p>}
    {status.error && <p role="alert">{status.error.message}</p>}
    {disconnect.error && <p role="alert">{disconnect.error.message}</p>}
    {accounts.length > 0 && <form className="mt-4 space-y-3" onSubmit={event => {
      event.preventDefault();
      if (accountId && !select.isPending) select.mutate(accountId);
    }}>
      <Label>Authorized Cloudflare account<select className="ml-2 rounded border px-2 py-1" required value={accountId} onChange={event => setAccountId(event.target.value)}>
        <option value="">Choose one account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} ({account.id})</option>)}
      </select></Label>
      <Button type="submit" variant="primary" disabled={!accountId || select.isPending}>Connect selected account</Button>
      {select.error && <p role="alert">{select.error.message}</p>}
    </form>}
  </>;
  return { count: connections.length, pending: status.isPending, feedback,
    rows: connections.map(row => <IntegrationRow key={row.id} kind="cloudflare" credentialId={row.id} name={"Cloudflare · " + row.name}
      detail={(row.writeEnabled ? "DNS writes enabled" : "Read only") + " · " + row.accountId}
      actions={[{ label: "Reconnect Cloudflare", onClick: start }, { label: "Disconnect", destructive: true, onClick: () => {
        if (window.confirm("Disconnect this Cloudflare account from Factorize?")) disconnect.mutate(row.id);
      }}]} />),
    tile: <ProviderTile kind="cloudflare" name="Cloudflare" description="Connect a Cloudflare account for direct REST API access." count={connections.length} onAdd={start} />,
    dialog: open && <Dialog title="Connect Cloudflare" close={() => setOpen(false)}>
      <p className="mb-3">Authorize Factorize on Cloudflare, then select one account to connect. No API key is needed.</p>
      {!data?.configured ? <p role="status">Cloudflare OAuth has not been configured for this deployment.</p> : <>
        {data.writeAvailable && <Label className="mb-4 flex items-center gap-2"><input type="checkbox" checked={writes} onChange={event => setWrites(event.target.checked)} />
          Enable DNS writes (optional)</Label>}
        <Button variant="primary" type="button" disabled={authorize.isPending} onClick={() => authorize.mutate()}>Continue to Cloudflare</Button>
      </>}
      {authorize.error && <p role="alert">{authorize.error.message}</p>}
    </Dialog>,
  };
}
