import type { JobInput } from "./editor-state";
import { Card, Input, Label } from "../../shared/ui";

type Scope = NonNullable<JobInput["runScopes"]>[number];
export const defaultRunScopes: Scope[] = ["projects:read", "jobs:read", "runs:read", "integrations:read", "skills:read", "runs:invoke"];
const scopes: Record<Scope, string> = {
  "projects:read": "View projects",
  "projects:write": "Create, edit, and delete projects",
  "jobs:read": "View jobs and their configuration",
  "jobs:write": "Create, edit, and delete jobs, including their run permissions",
  "runs:read": "View runs, traces, and diagnostics",
  "runs:invoke": "Invoke explicitly authorized destination jobs",
  "runs:cancel": "Stop runs",
  "runs:write": "Report errors and rename runs; includes run read, invoke, and cancel access",
  "integrations:read": "View integrations and provider resources",
  "integrations:write": "Configure and remove integrations",
  "skills:read": "View shared skills",
  "skills:write": "Create, edit, and delete shared skills",
};

export function RunPermissions({ value, onChange }: { value: Scope[]; onChange: (value: Scope[]) => void }) {
  return <Card className="space-y-3"><h2>Run permissions</h2>
    <p>Choose the Factorize API scopes granted to new runs of this job. Existing runs keep their issued scopes. Write permissions do not imply read permissions.</p>
    <p>Jobs with jobs:write can change job configuration and run permissions. Invoking another job also requires that destination in manual invocation permissions. Browser-only credential management and trace replay remain restricted.</p>
    <fieldset className="space-y-2"><legend className="sr-only">Run permission scopes</legend>
      {(Object.keys(scopes) as Scope[]).map(scope => <Label key={scope} className="block"><Input type="checkbox" aria-label={`Run scope ${scope}`} checked={value.includes(scope)} onChange={event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope))} /> <span>{scope}</span> — {scopes[scope]}</Label>)}
    </fieldset>
  </Card>;
}
