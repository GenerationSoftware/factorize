import type { operations } from "factorize-api-client";
import { HandlerTest } from "./handler-test";
import { useQuery } from "@tanstack/react-query";
import type { Trigger } from "./editor-state";
import { availabilityQuery } from "./editor-queries";
import { linearProjectsQuery, linearOptionsQuery, clickupListsQuery, clickupOptionsQuery, installationsQuery, repositoriesQuery, githubOptionsQuery, tailsQuery } from "./provider-queries";
type Config = Extract<Trigger, { kind: "webhook" }>["config"];
type Rule = Extract<Config, { provider: "linear" }>["matchRules"][number];
type Options = operations["get_api_v1_providers_linear_options"]["responses"][200]["content"]["application/json"];
function Rules({ rules, options, onChange }: { rules: Rule[]; options?: Options; onChange: (rules: Rule[]) => void }) {
  return <fieldset><legend>Matching rules</legend>{rules.map((rule, index) => <div key={index} className="flex flex-wrap gap-2">
    <label>Match type <select value={rule.type} onChange={e => onChange(rules.map((r, i) => i === index ? { type: e.target.value as Rule["type"], targetId: "" } : r))}>{["owner", "creator", "status", "label", "assignee"].map(type => <option key={type}>{type}</option>)}</select></label>
    <label>Match value <select required value={rule.targetId} onChange={e => onChange(rules.map((r, i) => i === index ? { ...r, targetId: e.target.value } : r))}><option value="">Choose a value</option>{(rule.type === "status" ? options?.statuses : rule.type === "label" ? options?.labels : options?.users)?.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}{rule.targetId && <option value={rule.targetId}>Current: {rule.targetId}</option>}</select></label>
    <button type="button" onClick={() => onChange(rules.filter((_, i) => i !== index))}>Remove rule</button></div>)}
    <button type="button" onClick={() => onChange([...rules, { type: "status", targetId: "" }])}>Add matching rule</button>
  </fieldset>;
}
function LinearFields({ config, onChange }: { config: Extract<Config, { provider: "linear" }>; onChange: (value: Config) => void }) {
  const projects = useQuery(linearProjectsQuery), options = useQuery(linearOptionsQuery);
  return <>{projects.error && <p role="alert">{projects.error.message}</p>}{options.error && <p role="alert">{options.error.message}</p>}<label>Linear project <select aria-label="Linear project" required value={config.projectId} onChange={e => onChange({ ...config, projectId: e.target.value })}><option value="">Choose a project</option>{projects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{config.projectId && <option value={config.projectId}>Current: {config.projectId}</option>}</select></label><Rules rules={config.matchRules} options={options.data} onChange={matchRules => onChange({ ...config, matchRules })} /></>;
}
function ClickupFields({ config, onChange }: { config: Extract<Config, { provider: "clickup" }>; onChange: (value: Config) => void }) {
  const lists = useQuery(clickupListsQuery), options = useQuery(clickupOptionsQuery(config.listId));
  return <>{lists.error && <p role="alert">{lists.error.message}</p>}{options.error && <p role="alert">{options.error.message}</p>}<label>ClickUp list <select aria-label="ClickUp list" required value={config.listId} onChange={e => onChange({ ...config, listId: e.target.value })}><option value="">Choose a list</option>{lists.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{config.listId && <option value={config.listId}>Current: {config.listId}</option>}</select></label><Rules rules={config.matchRules} options={options.data} onChange={matchRules => onChange({ ...config, matchRules })} /></>;
}
function GithubFields({ config, onChange }: { config: Extract<Config, { provider: "github" }>; onChange: (value: Config) => void }) {
  const installations = useQuery(installationsQuery), repositories = useQuery(repositoriesQuery(config.installationId)), options = useQuery(githubOptionsQuery(config.installationId, config.repositoryId));
  return <>{[installations.error, repositories.error, options.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}
    <label>GitHub installation <select aria-label="GitHub installation" required value={config.installationId || ""} onChange={e => onChange({ ...config, installationId: Number(e.target.value), repositoryId: 0 })}><option value="">Choose installation</option>{installations.data?.filter(i => i.state === "active").map(i => <option key={i.installationId} value={i.installationId}>{i.accountLogin}</option>)}{config.installationId > 0 && <option value={config.installationId}>Current: {config.installationId}</option>}</select></label>
    <label>GitHub repository <select aria-label="GitHub repository" required value={config.repositoryId || ""} onChange={e => onChange({ ...config, repositoryId: Number(e.target.value) })}><option value="">Choose repository</option>{repositories.data?.map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}{config.repositoryId > 0 && <option value={config.repositoryId}>Current: {config.repositoryId}</option>}</select></label>
    <label>GitHub event <input value={config.event ?? ""} onChange={e => onChange({ ...config, event: e.target.value })} /></label><label>GitHub action <input value={config.action ?? ""} onChange={e => onChange({ ...config, action: e.target.value })} /></label>
    <Rules rules={config.matchRules ?? []} options={options.data} onChange={matchRules => onChange({ ...config, matchRules })} />
  </>;
}
function TailFields({ config, onChange }: { config: Extract<Config, { provider: "cloudflareTail" }>; onChange: (value: Config) => void }) {
  const tails = useQuery(tailsQuery);
  return <>{tails.error && <p role="alert">{tails.error.message}</p>}<label>Tail integration <select aria-label="Tail integration" required value={config.integrationId} onChange={e => onChange({ ...config, integrationId: e.target.value })}><option value="">Choose integration</option>{tails.data?.map(t => <option key={t.integrationId} value={t.integrationId}>{t.name}</option>)}{config.integrationId && <option value={config.integrationId}>Current: {config.integrationId}</option>}</select></label></>;
}
const providerDefaults: Record<Config["provider"], Config> = { linear: { provider: "linear", projectId: "", matchRules: [] }, clickup: { provider: "clickup", listId: "", matchRules: [] }, github: { provider: "github", installationId: 0, repositoryId: 0, event: "pull_request", action: "opened" }, cloudflareTail: { provider: "cloudflareTail", integrationId: "" } };
export function ProviderFields({ config, onChange }: { config: Config; onChange: (value: Config) => void }) {
  const availability = useQuery(availabilityQuery);
  return <div className="grid gap-3"><label>Provider <select aria-label="Provider" value={config.provider} onChange={e => onChange(structuredClone(providerDefaults[e.target.value as Config["provider"]]))}>{Object.keys(providerDefaults).map(p => <option key={p} value={p} disabled={availability.data && !availability.data[p as Config["provider"]]}>{p}{availability.data && !availability.data[p as Config["provider"]] ? " (connect in settings)" : ""}</option>)}</select></label>
    {config.provider === "linear" && <LinearFields config={config} onChange={onChange} />}{config.provider === "clickup" && <ClickupFields config={config} onChange={onChange} />}{config.provider === "github" && <GithubFields config={config} onChange={onChange} />}{config.provider === "cloudflareTail" && <TailFields config={config} onChange={onChange} />}
    <label>Webhook handler (optional) <textarea maxLength={16_384} rows={5} value={config.handlerCode ?? ""} onChange={e => onChange({ ...config, handlerCode: e.target.value })} /></label><HandlerTest handlerCode={config.handlerCode ?? ""} />
  </div>;
}
