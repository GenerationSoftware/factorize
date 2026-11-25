import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
import { IntegrationRow, ProviderTile } from "./integration-ui";

const paths = {
  status: "/api/v1/integrations/cloudflare",
  authorize: "/api/v1/integrations/cloudflare/authorize",
  connection: "/api/v1/integrations/cloudflare/{connectionId}",
} as const;
const key = ["settings", "cloudflare-rest"];

export function useCloudflareIntegration() {
  const cache = useQueryClient();
  const result = new URLSearchParams(window.location.search).get("cloudflare");
  const status = useQuery({ queryKey: key, retry: false, queryFn: async ({ signal }) => {
    const { data, error } = await api.GET(paths.status, { signal });
    if (!data || error) throw new Error(messageOf(error));
    return data;
  }});
  const authorize = useMutation({ retry: false, mutationFn: async () => {
    const { data, error } = await api.POST(paths.authorize);
    if (!data || error) throw new Error(messageOf(error));
    return data.authorizationUrl;
  }, onSuccess: url => window.location.assign(url) });
  const disconnect = useMutation({ retry: false, mutationFn: async (id: string) => {
    const { error } = await api.DELETE(paths.connection, { params: { path: { connectionId: id } } });
    if (error) throw new Error(messageOf(error));
  }, onSuccess: () => cache.invalidateQueries({ queryKey: ["settings"] }) });
  const connections = status.data?.connections ?? [];
  const count = connections.filter(row => row.connected).length;
  const start = () => { if (!authorize.isPending) authorize.mutate(); };
  const feedback = <>
    {(result === "failed" || result === "expired" || result === "denied") && <p role="alert">Cloudflare did not complete authorization. Start a new connection when ready.</p>}
    {status.error && <p role="alert">{status.error.message}</p>}
    {authorize.error && <p role="alert">{authorize.error.message}</p>}
    {disconnect.error && <p role="alert">{disconnect.error.message}</p>}
  </>;
  return { count, pending: status.isPending, feedback, dialog: null,
    rows: connections.map(row => <IntegrationRow key={row.id} kind="cloudflare" credentialId={row.id}
      name={row.connected ? row.name : "Cloudflare: " + row.name}
      detail={row.reconnectRequired ? "Reconnect on Cloudflare to use this integration." : "Permissions managed in Cloudflare"}
      actions={[{ label: "Reconnect Cloudflare", onClick: start }, { label: "Disconnect", destructive: true, onClick: () => {
        if (window.confirm("Disconnect Cloudflare from Factorize?")) disconnect.mutate(row.id);
      }}]} />),
    tile: <ProviderTile kind="cloudflare" name="Cloudflare" description="Connect directly on Cloudflare to use its REST API." count={count} onAdd={start} />,
  };
}
