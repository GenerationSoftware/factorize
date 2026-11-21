import { useDisableCredentialAutofill } from "../../shared/credential-fields";
import {usePhoenixIntegration} from "./phoenix";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { integrationsQuery } from "./queries";
import { installationsQuery } from "../jobs/provider-queries";
import { Page } from "../../shared/ui";
import { IntegrationForm } from "./integration-form";
import { messageOf } from "../auth/session";
import { useBearerIntegrations } from "./bearer-integrations";
import { useFlyIntegration } from "./fly";
import { useXConnections } from "./x-connections";
import { useModelAccounts } from "./model-accounts";
import { IntegrationPoliciesProvider } from "./api-policies";
import { IntegrationRow, ProviderTile, type IntegrationAction } from "./integration-ui";
import { Dialog } from "../../shared/dialog";

type Kind = "exe" | "amp" | "cloudflareTail" | "github";
const linkClass = "inline-flex min-h-10 items-center rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold hover:bg-stone-100 dark:border-slate-700 dark:hover:bg-slate-800";
export function Integrations() {
  useDisableCredentialAutofill();
  return <Page><IntegrationPoliciesProvider><IntegrationsContent /></IntegrationPoliciesProvider></Page>;
}
function IntegrationsContent() {
  const cache = useQueryClient(), status = useQuery(integrationsQuery), github = useQuery(installationsQuery);
  const fly = useFlyIntegration(), bearer = useBearerIntegrations(), models = useModelAccounts(), x = useXConnections(), phoenix = usePhoenixIntegration();
  const [setup, setSetup] = useState<{title: string; form: ReactNode} | null>(null);
  const [feedback, setFeedback] = useState<{key: string; message: string; error: boolean} | null>(null);
  const action = useMutation({retry: false, mutationFn: async ({kind, id, test}: {kind: Kind; id: string; test?: boolean}) => {
    let result;
    if (kind === "exe") result = test ? await api.POST("/api/v1/integrations/exe/test", {body: {connectionId: id}}) : await api.DELETE("/api/v1/integrations/exe/{connectionId}", {params: {path: {connectionId: id}}});
    else if (kind === "amp") result = test ? await api.POST("/api/v1/integrations/amp/test", {body: {connectionId: id}}) : await api.DELETE("/api/v1/integrations/amp/{connectionId}", {params: {path: {connectionId: id}}});
    else if (kind === "cloudflareTail") result = test ? await api.POST("/api/v1/integrations/cloudflare-tail/{integrationId}/test", {params: {path: {integrationId: id}}}) : await api.DELETE("/api/v1/integrations/cloudflare-tail/{integrationId}", {params: {path: {integrationId: id}}});
    else result = await api.DELETE("/api/v1/providers/github/installations/{installationId}", {params: {path: {installationId: id}}});
    if (result.error) throw new Error(messageOf(result.error));
    if (test && (!result.data || !("ok" in result.data) || result.data.ok !== true)) {
      const missing = result.data && "missingPermissions" in result.data && Array.isArray(result.data.missingPermissions) ? result.data.missingPermissions.filter((permission): permission is string => typeof permission === "string") : [];
      throw new Error(missing.length ? `Connection verification failed. Missing exe.dev permissions: ${missing.join(", ")}.` : "Connection verification failed.");
    }
    return result.data;
  }, onSuccess: async (_result, variables) => {
    setFeedback({key: `${variables.kind}:${variables.id}`, message: variables.test ? "Connection verified." : "Integration disconnected.", error: false});
    await Promise.all([cache.invalidateQueries({queryKey: ["settings"]}), cache.invalidateQueries({queryKey: ["providers"]}), cache.invalidateQueries({queryKey: ["editor"]})]);
  }, onError: (error, variables) => setFeedback({key: `${variables.kind}:${variables.id}`, message: error.message, error: true})});
  const actions = (kind: Kind, id: string, edit?: () => void): IntegrationAction[] => [
    ...(edit ? [{label: "Edit integration", onClick: edit}] : []),
    ...(kind !== "github" ? [{label: "Test connection", disabled: action.isPending, onClick: () => {setFeedback(null); action.mutate({kind, id, test: true});}}] : []),
    {label: "Disconnect", destructive: true, disabled: action.isPending, onClick: () => {if (window.confirm("Disconnect this integration? Triggers that still reference it must be updated first.")) {setFeedback(null); action.mutate({kind, id});}}},
  ];
  const result = (key: string) => feedback?.key === key && <p className="mt-2 text-sm" role={feedback.error ? "alert" : "status"}>{feedback.message}</p>;
  const open = (title: string, form: ReactNode) => setSetup({title, form});
  const data = status.data;
  const count = (data?.linear ? 1 : 0) + (data?.clickup ? 1 : 0) + (github.data?.length ?? 0) + (data?.exeConnections.length ?? 0) + (data?.ampConnections.length ?? 0) + (data?.cloudflareTail.installations.length ?? 0) + fly.count + bearer.count + models.count + x.count + phoenix.count;
  const pending = status.isPending || github.isPending || fly.pending || bearer.pending || models.pending || x.pending || phoenix.pending;
  return <>
    {[status.error, github.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}
    <section aria-labelledby="your-integrations-heading"><h2 id="your-integrations-heading" className="text-xl font-bold">Installed Integrations</h2><p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">Manage workspace connections. Default API access applies to connected MCP clients; other access requires approval.</p>
      {pending && <p role="status">Loading integrations…</p>}
      {!count && !pending && <p className="rounded-xl border border-dashed border-stone-300 p-5 dark:border-slate-700">No integrations added yet. Choose a provider below to get started.</p>}
      {Boolean(count) && <div role="list" aria-label="Installed Integrations" className="rounded-xl border border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {data?.linear && <IntegrationRow kind="linear" credentialId="linear" name="Linear" detail={data.linear.organizationName ?? data.linear.viewerEmail ?? "Connected account"} actions={[{label: "Reconnect Linear", href: "/auth/linear"}]} />}
        {data?.clickup && <IntegrationRow kind="clickup" credentialId="clickup" name="ClickUp" detail={data.clickup.teamName ?? "Connected workspace"} actions={[{label: "Reconnect ClickUp", href: "/auth/clickup"}]} />}
        {github.data?.map(i => <IntegrationRow key={i.installationId} kind="github" credentialId={String(i.installationId)} name={`GitHub · ${i.accountLogin}`} detail={i.accountType} connected={i.state === "active"} status={i.state === "active" ? "Connected" : `Needs attention · ${i.state}`} actions={[{label: "Manage on GitHub", href: "https://github.com/settings/installations", external: true}, ...actions("github", String(i.installationId))]}>{result(`github:${i.installationId}`)}</IntegrationRow>)}
        {data?.exeConnections.map(c => <IntegrationRow key={c.connectionId} kind="exe" credentialId={c.connectionId} name={`exe.dev · ${c.connectionId}`} detail={(c.accountTags ?? []).join(", ") || "Account connection"} actions={actions("exe", c.connectionId, () => open("Edit exe.dev integration", <IntegrationForm kind="exe" connectionId={c.connectionId} initialTags={c.tags} />))}>{result(`exe:${c.connectionId}`)}</IntegrationRow>)}
        {data?.ampConnections.map(c => <IntegrationRow key={c.connectionId} kind="amp" credentialId={c.connectionId} name={`Amp · ${c.project}`} detail="Project connection" actions={actions("amp", c.connectionId, () => open("Edit Amp integration", <IntegrationForm kind="amp" connectionId={c.connectionId} initialName={c.project} initialApiBaseUrl={c.apiBaseUrl} />))}>{result(`amp:${c.connectionId}`)}</IntegrationRow>)}
        {fly.rows}{bearer.rows}{models.rows}{x.rows}{phoenix.rows}
        {data?.cloudflareTail.installations.map(c => <IntegrationRow key={c.integrationId} kind="tail" credentialId={c.integrationId} name={`Cloudflare Tail · ${c.name}`} detail={`Referenced by ${c.referencedTriggerCount} ${c.referencedTriggerCount === 1 ? "trigger" : "triggers"}`} actions={actions("cloudflareTail", c.integrationId, () => open("Edit Tail integration", <IntegrationForm kind="cloudflareTail" connectionId={c.integrationId} initialName={c.name} />))}>{result(`cloudflareTail:${c.integrationId}`)}</IntegrationRow>)}
      </div>}
      {feedback && !feedback.error && feedback.message === "Integration disconnected." && <p role="status">Integration disconnected.</p>}
      {fly.feedback}{bearer.feedback}{models.feedback}{x.feedback}{phoenix.feedback}
    </section>
    <section aria-labelledby="available-integrations-heading" className="mt-10"><h2 id="available-integrations-heading" className="text-xl font-bold">Available integrations</h2><p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">Choose a provider to connect or configure an integration.</p><ul aria-label="Available integration providers" className="overflow-hidden rounded-xl border border-stone-200 dark:border-slate-800">
      <ProviderTile kind="linear" name="Linear" description="Create and update issues." count={data?.linear ? 1 : 0} href="/auth/linear" />
      <ProviderTile kind="clickup" name="ClickUp" description="Event workflows from tasks and lists." count={data?.clickup ? 1 : 0} href="/auth/clickup" />
      <ProviderTile kind="github" name="GitHub" description="Connect repositories and pull requests." count={github.data?.length ?? 0} href="/auth/github/install" />
      <ProviderTile kind="exe" name="exe.dev" description="Run triggers on your VMs." count={data?.exeConnections.length ?? 0} onAdd={() => open("Add exe.dev integration", <IntegrationForm kind="exe" />)} />
      <ProviderTile kind="amp" name="Amp" description="Run workflows against an Amp project." count={data?.ampConnections.length ?? 0} onAdd={() => open("Add Amp integration", <IntegrationForm kind="amp" />)} />
      {fly.tile}{bearer.tile}{models.tile}{x.tile}{phoenix.tile}
      <ProviderTile kind="tail" name="Cloudflare Tail" description="Capture Worker logs through webhooks." count={data?.cloudflareTail.installations.length ?? 0} onAdd={() => open("Add Tail integration", <IntegrationForm kind="cloudflareTail" />)} />
    </ul></section>
    {setup && <Dialog title={setup.title} close={() => setSetup(null)}>{setup.form}</Dialog>}{fly.dialog}{bearer.dialog}{models.dialog}{x.dialog}{phoenix.dialog}
  </>;
}
