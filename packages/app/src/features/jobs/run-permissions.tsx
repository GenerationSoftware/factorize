import type { TriggerInput } from "./editor-state";
import { Card, Input, Label } from "../../shared/ui";

type Scope = NonNullable<TriggerInput["runScopes"]>[number];
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

export function RunPermissions({ value, onChange }: { value: Scope[]; onChange: (value: Scope[]) => void }) {
  return <Card className="space-y-3"><h2>Run permissions</h2>
    <p>Choose the Factorize API scopes granted to new runs of this trigger. Existing runs keep their issued scopes. Write permissions do not imply read permissions.</p>
    <p>Triggers with triggers:write can change trigger configuration and run permissions. Invoking another trigger also requires that destination in manual invocation permissions. Browser-only credential management and trace replay remain restricted.</p>
    <fieldset className="space-y-2"><legend className="sr-only">Run permission scopes</legend>
      {(Object.keys(scopes) as Scope[]).map(scope => <Label key={scope} className="block"><Input type="checkbox" aria-label={`Run scope ${scope}`} checked={value.includes(scope)} onChange={event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope))} /> <span>{scope}</span> — {scopes[scope]}</Label>)}
    </fieldset>
  </Card>;
}
