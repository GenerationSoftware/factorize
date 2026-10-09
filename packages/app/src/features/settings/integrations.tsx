import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { integrationsQuery } from "./queries";
import { installationsQuery } from "../jobs/provider-queries";
import { SettingsNavigation } from "./navigation";
import { IntegrationForm } from "./integration-form";
import { messageOf } from "../auth/session";
export function Integrations() {
  const cache = useQueryClient(), status = useQuery(integrationsQuery), github = useQuery(installationsQuery);
  const action = useMutation({ retry: false, mutationFn: async ({ kind, id, test }: { kind: "exe" | "amp" | "cloudflareTail" | "github"; id: string; test?: boolean }) => {
    let result;
    if (kind === "exe") result = test ? await api.POST("/api/v1/integrations/exe/test", { body: { connectionId: id } }) : await api.DELETE("/api/v1/integrations/exe/{connectionId}", { params: { path: { connectionId: id } } });
    else if (kind === "amp") result = test ? await api.POST("/api/v1/integrations/amp/test", { body: { connectionId: id } }) : await api.DELETE("/api/v1/integrations/amp/{connectionId}", { params: { path: { connectionId: id } } });
    else if (kind === "cloudflareTail") result = test ? await api.POST("/api/v1/integrations/cloudflare-tail/{integrationId}/test", { params: { path: { integrationId: id } } }) : await api.DELETE("/api/v1/integrations/cloudflare-tail/{integrationId}", { params: { path: { integrationId: id } } });
    else result = await api.DELETE("/api/v1/providers/github/installations/{installationId}", { params: { path: { installationId: id } } });
    if (result.error) throw new Error(messageOf(result.error)); return { test, result: result.data };
  }, onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["settings"] }); await cache.invalidateQueries({ queryKey: ["providers"] }); await cache.invalidateQueries({ queryKey: ["editor"] }); } });
  const buttons = (kind: "exe" | "amp" | "cloudflareTail" | "github", id: string) => <div className="flex gap-3">{kind !== "github" && <button disabled={action.isPending} onClick={() => action.mutate({ kind, id, test: true })}>Test connection</button>}<button disabled={action.isPending} onClick={() => { if (window.confirm("Disconnect this integration? Jobs that still reference it must be updated first.")) action.mutate({ kind, id }); }}>Disconnect</button></div>;
  return <main className="mx-auto max-w-4xl p-6"><h1 className="text-3xl font-semibold">Integrations</h1><SettingsNavigation />
    {status.isPending && <p role="status">Loading integrations…</p>}{[status.error, github.error, action.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}
    {action.data?.test && <pre role="status" className="whitespace-pre-wrap break-words">{JSON.stringify(action.data.result, null, 2)}</pre>}
    <section className="my-6"><h2 className="text-xl font-semibold">Linear</h2><p>{status.data?.linear?.organizationName ?? "Not connected"}</p><a href="/auth/linear">{status.data?.linear ? "Reconnect Linear" : "Connect Linear"}</a></section>
    <section className="my-6"><h2 className="text-xl font-semibold">ClickUp</h2><p>{status.data?.clickup?.teamName ?? "Not connected"}</p><a href="/auth/clickup">{status.data?.clickup ? "Reconnect ClickUp" : "Connect ClickUp"}</a></section>
    <section className="my-6"><h2 className="text-xl font-semibold">GitHub</h2><a href="/auth/github/install">Connect GitHub</a>{github.data?.map(i => <div className="my-4" key={i.installationId}><p>{i.accountLogin} · {i.state}</p><a href="https://github.com/settings/installations" target="_blank" rel="noreferrer">Configure installation</a>{buttons("github", String(i.installationId))}</div>)}</section>
    <section className="my-6"><h2 className="text-xl font-semibold">exe.dev</h2>{status.data?.exeConnections.map(c => <details key={c.connectionId}><summary>{c.agentKind} · {c.tags.join(", ") || "No tags"}</summary>{buttons("exe", c.connectionId)}<IntegrationForm kind="exe" connectionId={c.connectionId} initialAgent={c.agentKind} initialTags={c.tags} /></details>)}<details><summary>Add exe.dev integration</summary><IntegrationForm kind="exe" /></details></section>
    <section className="my-6"><h2 className="text-xl font-semibold">Amp</h2>{status.data?.ampConnections.map(c => <details key={c.connectionId}><summary>{c.project}</summary>{buttons("amp", c.connectionId)}<IntegrationForm kind="amp" connectionId={c.connectionId} initialName={c.project} initialApiBaseUrl={c.apiBaseUrl} /></details>)}<details><summary>Add Amp integration</summary><IntegrationForm kind="amp" /></details></section>
    <section className="my-6"><h2 className="text-xl font-semibold">Cloudflare Tail</h2>{status.data?.cloudflareTail.installations.map(c => <details key={c.integrationId}><summary>{c.name} · {c.referencedJobCount} jobs</summary>{buttons("cloudflareTail", c.integrationId)}<IntegrationForm kind="cloudflareTail" connectionId={c.integrationId} initialName={c.name} /></details>)}<details><summary>Add Tail integration</summary><IntegrationForm kind="cloudflareTail" /></details></section>
  </main>;
}
