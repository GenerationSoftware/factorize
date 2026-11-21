import { SecretInput } from "../../shared/credential-fields";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { Dialog } from "../../shared/dialog";
import { messageOf } from "../auth/session";
import { IntegrationRow, ProviderTile } from "./integration-ui";

export const phoenixQuery = { queryKey: ["settings", "phoenix"], queryFn: async () => {
  const { data, error } = await api.GET("/api/v1/integrations/phoenix");
  if (error || !data) throw new Error(messageOf(error)); return data;
} };
export function usePhoenixIntegration() {
  const query = useQuery(phoenixQuery), cache = useQueryClient();
  const [open, setOpen] = useState(false), [endpoint, setEndpoint] = useState(""), [project, setProject] = useState("factorize"), [key, setKey] = useState(""), [enabled, setEnabled] = useState(true);
  const action = useMutation({ retry: false, mutationFn: async (kind: "save" | "test" | "disconnect") => {
    const response = kind === "save" ? await api.PUT("/api/v1/integrations/phoenix", { body: { endpoint, projectName: project, enabled, expectedRevision: query.data?.revision ?? 0, ...(key ? { apiKey: key } : {}) } }) : kind === "test" ? await api.POST("/api/v1/integrations/phoenix/test") : await api.DELETE("/api/v1/integrations/phoenix", { body: { expectedRevision: query.data!.revision } });
    if (response.error) throw new Error(messageOf(response.error));
    if (kind === "test") { const result = response.data as { connected: boolean; error: string | null }; if (!result.connected) throw new Error(result.error ?? "Connection failed."); }
    return kind;
  }, onSuccess: async kind => { if (kind !== "test") { setKey(""); setOpen(false); } await cache.invalidateQueries({ queryKey: phoenixQuery.queryKey }); } });
  const edit = () => { action.reset(); setEndpoint(query.data?.endpoint ?? ""); setProject(query.data?.projectName ?? "factorize"); setEnabled(query.data?.configured ? query.data.enabled : true); setKey(""); setOpen(true); };
  const close = () => { setKey(""); setOpen(false); action.reset(); };
  return {
    count: query.data?.configured ? 1 : 0, pending: query.isPending,
    rows: query.data?.configured ? <IntegrationRow kind="phoenix" credentialId="phoenix" name="Phoenix Cloud telemetry" detail={query.data.projectName} connected={!query.data.lastError} status={query.data.lastError ? "Needs attention" : query.data.enabled ? "Connected" : "Export paused"} actions={[
      { label: "Edit integration", onClick: edit },
      { label: "Test connection", disabled: action.isPending, onClick: () => action.mutate("test") },
      { label: "Disconnect", destructive: true, disabled: action.isPending, onClick: () => { if (window.confirm("Disconnect Phoenix? Pending exports will be canceled. Local telemetry will remain available.")) action.mutate("disconnect"); } },
    ]}>{query.data.lastError && <p className="mt-2 text-sm">{query.data.lastError}</p>}</IntegrationRow> : null,
    tile: <ProviderTile kind="phoenix" name="Phoenix Cloud telemetry" description="Export run traces to Phoenix Cloud." count={query.data?.configured ? 1 : 0} onAdd={edit} />,
    feedback: <>{query.error && <p role="alert">{query.error.message}</p>}{!open && action.error && <p role="alert">{action.error.message}</p>}{!open && action.isSuccess && <p role="status">{action.data === "test" ? "Phoenix connection verified." : action.data === "save" ? "Phoenix settings saved." : "Phoenix disconnected."}</p>}</>,
    dialog: open && <Dialog title={query.data?.configured ? "Edit Phoenix integration" : "Add Phoenix integration"} close={close}>
      <p className="mb-4 text-sm">Export new runs, including captured conversation and tool content. Local telemetry stays available when export is disabled or Phoenix is unavailable.</p>
      <form autoComplete="off" method="post" className="grid gap-3" onSubmit={event => { event.preventDefault(); action.mutate("save"); }}>
        <Label>Phoenix base URL<Input type="url" required maxLength={2048} placeholder="https://app.phoenix.arize.com/s/your-space" value={endpoint} onChange={e => setEndpoint(e.target.value)} /></Label>
        <Label>Phoenix project<Input required maxLength={128} value={project} onChange={e => setProject(e.target.value)} /></Label>
        <Label>Phoenix API key<SecretInput name="phoenix-api-key" required={!query.data?.credentialConfigured} value={key} maxLength={8192} onChange={e => setKey(e.target.value)} />{query.data?.credentialConfigured && <span className="text-xs">Leave blank to keep the configured key.</span>}</Label>
        <Label><Input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Export telemetry for new runs</Label>
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={action.isPending || query.isPending || !!query.error}>Save Phoenix settings</Button><Button type="button" onClick={close}>Cancel</Button></div>
      </form>{action.error && <p role="alert">{action.error.message}</p>}
    </Dialog>,
  };
}
