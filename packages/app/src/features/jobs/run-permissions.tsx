import type { TriggerInput } from "./editor-state";
import { Card, Input, Label } from "../../shared/ui";

export type Scope = NonNullable<TriggerInput["runScopes"]>[number];
export const defaultRunScopes: Scope[] = ["team:read", "triggers:read", "runs:read", "integrations:read", "skills:read", "runs:invoke"];
const scopes: Record<Scope, string> = {
  "team:read": "View Team settings",
  "team:write": "Edit Team settings",
  "triggers:read": "View triggers and their configuration",
  "triggers:write": "Create, edit, and delete triggers, including their run permissions",
  "runs:read": "View runs, traces, and diagnostics",
  "runs:start": "Start direct runs with Team defaults", "runs:invoke": "Invoke explicitly authorized destination triggers",
  "runs:cancel": "Stop runs",
  "runs:write": "Report errors and rename runs",
  "integrations:read": "View integrations and provider resources",
  "integrations:write": "Configure and remove integrations",
  "skills:read": "View shared skills",
  "skills:write": "Create, edit, and delete shared skills",
};

const scopeGroups: { name: string; scopes: Scope[] }[] = [
  { name: "Skills", scopes: ["skills:read", "skills:write"] },
  { name: "Runs", scopes: ["runs:read", "runs:start", "runs:invoke", "runs:cancel", "runs:write"] },
  { name: "Triggers", scopes: ["triggers:read", "triggers:write"] },
  { name: "Integrations", scopes: ["integrations:read", "integrations:write"] },
  { name: "Team settings", scopes: ["team:read", "team:write"] },
];
export function RunPermissions({ value, onChange, presentation = "default" }: { value: Scope[]; onChange: (value: Scope[]) => void; presentation?: "default" | "preset" }) {
  if (presentation === "preset") return <section aria-label="Application permissions" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="!mb-0 text-lg font-semibold">Application permissions</h2><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{value.length} of {Object.keys(scopes).length} selected</span></div>
    <p className="text-sm text-slate-600 dark:text-slate-400">Choose what runs using this preset can do in Factorize. Write access is separate from read access.</p>
    <div className="space-y-4 sm:columns-2 sm:gap-4">{scopeGroups.map(group => <fieldset key={group.name} className="break-inside-avoid !overflow-hidden !rounded-xl !border-stone-200 !p-0 dark:!border-slate-700"><legend className="sr-only">{group.name} permissions</legend>
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900"><h3 className="!mb-0 text-sm font-semibold">{group.name}</h3><span className="text-xs text-slate-500 dark:text-slate-400">{group.scopes.filter(scope => value.includes(scope)).length}/{group.scopes.length}</span></div>
      <div className="divide-y divide-stone-200 dark:divide-slate-700">{group.scopes.map(scope => <Label key={scope} className={`flex min-h-16 cursor-pointer items-start gap-3 px-4 py-3 transition-colors ${value.includes(scope) ? "bg-factorize-50 dark:bg-factorize-500/10" : "bg-white hover:bg-stone-50 dark:bg-slate-900 dark:hover:bg-slate-800"}`}><Input type="checkbox" className="!mr-0 mt-1 shrink-0" aria-label={`Run scope ${scope}`} checked={value.includes(scope)} onChange={event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope))}/><span className="min-w-0"><span className="block text-sm font-medium">{scopes[scope]}</span><code className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">{scope}</code></span></Label>)}</div>
    </fieldset>)}</div>
    <p className="text-xs text-slate-500 dark:text-slate-400">Changes apply to future runs. Starting other triggers also requires selecting them below.</p>
  </section>;
  return <Card className="space-y-3"><h2>Run permissions</h2>
    <p>Choose the Factorize API scopes granted to new runs. Existing runs keep their issued scopes. Write permissions do not imply read permissions.</p>
    <p>Runs with triggers:write can change trigger configuration and future run permissions. Invoking another trigger also requires that destination in manual invocation permissions. Browser-only credential management and trace replay remain restricted.</p>
    <fieldset className="space-y-2"><legend className="sr-only">Run permission scopes</legend>
      {(Object.keys(scopes) as Scope[]).map(scope => <Label key={scope} className="block"><Input type="checkbox" aria-label={`Run scope ${scope}`} checked={value.includes(scope)} onChange={event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope))} /> <span>{scope}</span> — {scopes[scope]}</Label>)}
    </fieldset>
  </Card>;
}
