import { useCloudflareIntegration } from "./cloudflare";
import { useDisableCredentialAutofill } from "../../shared/credential-fields";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { integrationsQuery } from "./queries";
import { installationsQuery } from "./provider-queries";
import { SettingsLayout } from "./navigation";
import { IntegrationForm } from "./integration-form";
import { useBearerIntegrations } from "./bearer-integrations";
import { useFlyIntegration } from "./fly";
import { useXConnections } from "./x-connections";
import { IntegrationDefaultPrompt, IntegrationPoliciesProvider } from "./api-policies";
import { IntegrationRow, ProviderTile, type IntegrationAction } from "./integration-ui";
import { Table, tableCellClasses, tableHeadClasses } from "../../shared/ui";
import { defaultColumn } from "./permissions";
import { Dialog } from "../../shared/dialog";
import { useIntegrationRemoval } from "./integration-removal";

type Kind = "exe" | "amp" | "cloudflareTail" | "github";
export function Integrations() {
  useDisableCredentialAutofill();
  return <SettingsLayout title="Integrations"><IntegrationPoliciesProvider><IntegrationsContent /></IntegrationPoliciesProvider></SettingsLayout>;
}
function IntegrationsContent() {
  const status = useQuery(integrationsQuery), github = useQuery(installationsQuery);
  const removal = useIntegrationRemoval();
  const fly = useFlyIntegration(removal.open, removal.busy);
  const bearer = useBearerIntegrations(removal.open, removal.busy);
  const x = useXConnections();
  const cloudflare = useCloudflareIntegration(removal.open, removal.busy);
  const [setup, setSetup] = useState<{title: string; form: ReactNode} | null>(null);
  const actions = (kind: Kind, id: string, name: string, edit?: () => void): IntegrationAction[] => [
    ...(edit ? [{label: "Edit integration", onClick: edit}] : []),
    {label: "Disconnect", destructive: true, disabled: removal.busy, onClick: () => removal.open({kind, id, name})},
  ];
  const open = (title: string, form: ReactNode) => setSetup({title, form});
  const data = status.data;
  const count = (data?.linear ? 1 : 0) + (data?.clickup ? 1 : 0) + (github.data?.length ?? 0) + (data?.exeConnections.length ?? 0) + (data?.ampConnections.length ?? 0) + (data?.cloudflareTail.installations.length ?? 0) + fly.count + bearer.count + x.count + cloudflare.count;
  const pending = status.isPending || github.isPending || fly.pending || bearer.pending || x.pending || cloudflare.pending;
  return <>
    {[status.error, github.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}
    <section aria-labelledby="your-integrations-heading"><h2 id="your-integrations-heading" className="text-xl font-bold">Installed Integrations</h2><p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">Manage workspace connections. Defaults only preselect integrations for new connections.</p>
      {pending && <p role="status">Loading integrations…</p>}
      {!count && !pending && <p className="rounded-xl border border-dashed border-stone-300 p-5 dark:border-slate-700">No integrations added yet. Choose a provider below to get started.</p>}
      {Boolean(count) && <><IntegrationDefaultPrompt /><Table aria-label="Installed integrations" className="table-fixed"><thead className={tableHeadClasses}><tr><th scope="col" className={tableCellClasses}>Integration</th><th scope="col" className={defaultColumn}>Available by Default</th></tr></thead><tbody>
        {data?.linear && <IntegrationRow kind="linear" credentialId="linear" name="Linear" detail={[data.linear.organizationName, data.linear.viewerEmail].filter(Boolean).join(" · ")} actions={[{label: "Reconnect Linear", href: "/auth/linear"}]} />}
        {data?.clickup && <IntegrationRow kind="clickup" credentialId="clickup" name="ClickUp" detail={data.clickup.teamName ?? undefined} actions={[{label: "Reconnect ClickUp", href: "/auth/clickup"}]} />}
        {github.data?.map(i => <IntegrationRow key={i.installationId} kind="github" credentialId={String(i.installationId)} name="GitHub" detail={`${i.accountLogin} · ${i.accountType} · #${i.installationId}`} status={i.state === "active" ? undefined : `Needs attention · ${i.state}`} actions={[{label: "Manage on GitHub", href: "https://github.com/settings/installations", external: true}, ...actions("github", String(i.installationId), `GitHub · ${i.accountLogin} · #${i.installationId}`)]} />)}
        {data?.exeConnections.map(c => <IntegrationRow key={c.connectionId} kind="exe" credentialId={c.connectionId} name="exe.dev" detail={c.connectionId} actions={actions("exe", c.connectionId, `exe.dev · ${c.connectionId}`, () => open("Edit exe.dev integration", <IntegrationForm kind="exe" connectionId={c.connectionId} />))} />)}
        {data?.ampConnections.map(c => <IntegrationRow key={c.connectionId} kind="amp" credentialId={c.connectionId} name="Amp" detail={c.project} actions={actions("amp", c.connectionId, `Amp · ${c.project}`, () => open("Edit Amp integration", <IntegrationForm kind="amp" connectionId={c.connectionId} initialName={c.project} initialApiBaseUrl={c.apiBaseUrl} />))} />)}
        {fly.rows}{bearer.rows}{x.rows}{cloudflare.rows}
        {data?.cloudflareTail.installations.map(c => <IntegrationRow key={c.integrationId} kind="tail" credentialId={c.integrationId} name="Cloudflare Tail" status="Retired" detail={`${c.name} · Referenced by ${c.referencedTriggerCount} ${c.referencedTriggerCount === 1 ? "trigger" : "triggers"}`} actions={actions("cloudflareTail", c.integrationId, `Cloudflare Tail · ${c.name}`)} />)}
      </tbody></Table></>}
      {removal.notice}
      {fly.feedback}{bearer.feedback}{x.feedback}{cloudflare.feedback}
    </section>
    <section aria-labelledby="available-integrations-heading" className="mt-10"><h2 id="available-integrations-heading" className="text-xl font-bold">Available integrations</h2><p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">Choose a provider to connect or configure an integration.</p><ul aria-label="Available integration providers" className="overflow-hidden rounded-xl border border-stone-200 dark:border-slate-800">
      <ProviderTile kind="linear" name="Linear" description="Create and update issues." count={data?.linear ? 1 : 0} href="/auth/linear" />
      <ProviderTile kind="clickup" name="ClickUp" description="Event workflows from tasks and lists." count={data?.clickup ? 1 : 0} href="/auth/clickup" />
      <ProviderTile kind="github" name="GitHub" description="Connect repositories and pull requests." count={github.data?.length ?? 0} href="/auth/github/install" />
      <ProviderTile kind="exe" name="exe.dev" description="Connect an exe.dev API for client access." count={data?.exeConnections.length ?? 0} onAdd={() => open("Add exe.dev integration", <IntegrationForm kind="exe" />)} />
      <ProviderTile kind="amp" name="Amp" description="Connect an Amp project API for client access." count={data?.ampConnections.length ?? 0} onAdd={() => open("Add Amp integration", <IntegrationForm kind="amp" />)} />
      {fly.tile}{bearer.tile}{x.tile}{cloudflare.tile}
    </ul></section>
    {setup && <Dialog title={setup.title} close={() => setSetup(null)}>{setup.form}</Dialog>}{fly.dialog}{bearer.dialog}{x.dialog}{cloudflare.dialog}{removal.dialog}
  </>;
}
