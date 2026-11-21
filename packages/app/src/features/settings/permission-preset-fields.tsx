import { NavIcon } from "../../shared/nav-icon";
import { ProviderCredentials, type ProviderSelections } from "../jobs/provider-credentials";
import { RunPermissions, type Scope } from "../jobs/run-permissions";
import { LifecycleSelector } from "../jobs/lifecycle-selector";

type PermissionSettings = ProviderSelections & { runScopes?: Scope[]; allowedTriggerIds?: string[] };
export function PermissionPresetFields({ value, onChange }: { value: PermissionSettings; onChange: (value: PermissionSettings) => void }) {
  const integrations = (value.portableIntegrationIds?.length ?? 0) + (value.githubInstallationIds?.length ?? 0) + (value.xConnectionIds?.length ?? 0) + (value.linearConnectionId ? 1 : 0);
  return <div className="space-y-8">
    <div className="flex items-start gap-3 rounded-xl border border-factorize-100 bg-factorize-50 p-4 dark:border-factorize-500/20 dark:bg-factorize-500/10"><span className="mt-0.5 text-factorize-700 dark:text-factorize-500"><NavIcon name="key"/></span><p className="text-sm text-slate-700 dark:text-slate-300">Choose what runs can access. Skills use the team default unless they select another permission preset.</p></div>
    <RunPermissions presentation="preset" value={value.runScopes ?? []} onChange={runScopes => onChange({ ...value, runScopes })}/>
    <section aria-label="Integration access" className="rounded-xl border border-stone-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="!mb-0 text-lg font-semibold">Integration access</h2><span className="text-xs text-slate-500 dark:text-slate-400">{integrations} selected</span></div>
      <div className="permission-preset-connections"><ProviderCredentials value={value} onChange={next => onChange({ ...value, ...next })}/></div>
    </section>
    <LifecycleSelector presentation="preset" kind="destination" selected={value.allowedTriggerIds ?? []} onChange={allowedTriggerIds => onChange({ ...value, allowedTriggerIds })}/>
  </div>;
}
