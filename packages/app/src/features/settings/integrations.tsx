import { IntegrationIcon } from "./icon";
import { Disclosure, Summary, Button, Page, Card } from "../../shared/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { integrationsQuery } from "./queries";
import { installationsQuery } from "../jobs/provider-queries";
import { SettingsLayout } from "./navigation";
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
  const buttons = (kind: "exe" | "amp" | "cloudflareTail" | "github", id: string) => <div className="flex flex-wrap gap-3">{kind !== "github" && <Button disabled={action.isPending} onClick={() => action.mutate({ kind, id, test: true })}>Test connection</Button>}<Button disabled={action.isPending} onClick={() => { if (window.confirm("Disconnect this integration? Jobs that still reference it must be updated first.")) action.mutate({ kind, id }); }}>Disconnect</Button></div>;
  return <SettingsLayout title="Integrations">
    {status.isPending && <p role="status">Loading integrations…</p>}{[status.error, github.error, action.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}
    {action.data?.test && <pre role="status" className="whitespace-pre-wrap break-words">{JSON.stringify(action.data.result, null, 2)}</pre>}
    <div className="grid gap-4 sm:grid-cols-2"><Card><div className="mb-4 flex items-center gap-3"><IntegrationIcon kind="linear" /><h2 className="mb-0 text-lg font-semibold">Linear</h2></div><p>{status.data?.linear?.organizationName ?? "Not connected"}</p><a className="mt-3 inline-block rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold dark:border-slate-700" href="/auth/linear">{status.data?.linear ? "Reconnect Linear" : "Connect Linear"}</a></Card>
    <Card><div className="mb-4 flex items-center gap-3"><IntegrationIcon kind="clickup" /><h2 className="mb-0 text-lg font-semibold">ClickUp</h2></div><p>{status.data?.clickup?.teamName ?? "Not connected"}</p><a className="mt-3 inline-block rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold dark:border-slate-700" href="/auth/clickup">{status.data?.clickup ? "Reconnect ClickUp" : "Connect ClickUp"}</a></Card>
    <Card><div className="mb-4 flex items-center gap-3"><IntegrationIcon kind="github" /><h2 className="mb-0 text-lg font-semibold">GitHub</h2></div><a className="mt-3 inline-block rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold dark:border-slate-700" href="/auth/github/install">Connect GitHub</a>{github.data?.map(i => <div className="my-4" key={i.installationId}><p>{i.accountLogin} · {i.state}</p><a href="https://github.com/settings/installations" target="_blank" rel="noreferrer">Configure installation</a>{buttons("github", String(i.installationId))}</div>)}</Card>
    <Card><div className="mb-4 flex items-center gap-3"><IntegrationIcon kind="exe" /><h2 className="mb-0 text-lg font-semibold">exe.dev</h2></div>{status.data?.exeConnections.map(c => <Disclosure key={c.connectionId}><Summary>{c.agentKind} · {c.tags.join(", ") || "No tags"}</Summary>{buttons("exe", c.connectionId)}<IntegrationForm kind="exe" connectionId={c.connectionId} initialAgent={c.agentKind} initialTags={c.tags} /></Disclosure>)}<Disclosure><Summary>Add exe.dev integration</Summary><IntegrationForm kind="exe" /></Disclosure></Card>
    <Card><div className="mb-4 flex items-center gap-3"><IntegrationIcon kind="amp" /><h2 className="mb-0 text-lg font-semibold">Amp</h2></div>{status.data?.ampConnections.map(c => <Disclosure key={c.connectionId}><Summary>{c.project}</Summary>{buttons("amp", c.connectionId)}<IntegrationForm kind="amp" connectionId={c.connectionId} initialName={c.project} initialApiBaseUrl={c.apiBaseUrl} /></Disclosure>)}<Disclosure><Summary>Add Amp integration</Summary><IntegrationForm kind="amp" /></Disclosure></Card>
    <Card><div className="mb-4 flex items-center gap-3"><IntegrationIcon kind="tail" /><h2 className="mb-0 text-lg font-semibold">Cloudflare Tail</h2></div>{status.data?.cloudflareTail.installations.map(c => <Disclosure key={c.integrationId}><Summary>{c.name} · {c.referencedJobCount} jobs</Summary>{buttons("cloudflareTail", c.integrationId)}<IntegrationForm kind="cloudflareTail" connectionId={c.integrationId} initialName={c.name} /></Disclosure>)}<Disclosure><Summary>Add Tail integration</Summary><IntegrationForm kind="cloudflareTail" /></Disclosure></Card>
  </div></SettingsLayout>;
}
