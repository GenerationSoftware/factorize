import { Button, Input, Select, Label, Card } from "../../shared/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { tokensQuery } from "./queries";
import { SettingsLayout } from "./navigation";
import { messageOf } from "../auth/session";

const allScopes = ["projects:read", "projects:write", "jobs:read", "jobs:write", "runs:read", "runs:invoke", "runs:cancel", "integrations:read", "integrations:write"] as const;
const scopeDescriptions: Record<typeof allScopes[number], string> = { "projects:read": "View projects", "projects:write": "Create, rename, and delete projects", "jobs:read": "View jobs and job configuration", "jobs:write": "Create, edit, enable, disable, and delete jobs", "runs:read": "View runs, traces, context, and diagnostics", "runs:invoke": "Start jobs", "runs:cancel": "Stop or cancel runs", "integrations:read": "View integrations and provider resources", "integrations:write": "Create, configure, test, and remove integrations" };

export function ApiKeyCreate() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<(typeof allScopes[number])[]>(["jobs:read", "runs:read"]);
  const [expiryDays, setExpiryDays] = useState<7 | 30 | 90>(30);
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/access-tokens", { body: { name, scopes, expiryDays } });
      if (!data || error) throw new Error(messageOf(error));
      const { token, ...metadata } = data;
      setSecret(token);
      return metadata;
    },
    onSuccess: async () => { setName(""); await cache.invalidateQueries({ queryKey: tokensQuery.queryKey }); },
  });
  return <SettingsLayout title="Create API key">
    <Link to="/settings/api-keys" className="text-sm font-semibold">← API keys</Link>
    {secret ? <Card role="status" className="mt-5 border p-4">
      <p>Copy this key now. It will only be displayed once.</p>
      <pre className="break-all whitespace-pre-wrap" aria-label="One-time API key">{secret}</pre>
      <div className="flex flex-wrap gap-2"><Button onClick={() => void navigator.clipboard.writeText(secret)}>Copy key</Button><Button onClick={() => void navigate({ to: "/settings/api-keys" })}>Dismiss key</Button></div>
    </Card> : <form className="my-4 grid gap-3" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
      <Label>Key name <Input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Label>
      <p>Permissions are independent: write does not imply read. Job writes can affect future schedule, webhook, and lifecycle executions; deleting a job may remove its run history and artifacts.</p>
      <fieldset><legend>Permissions</legend>{allScopes.map(scope => <Label key={scope} className="block"><Input aria-label={scope} type="checkbox" checked={scopes.includes(scope)} onChange={e => setScopes(e.target.checked ? [...scopes, scope] : scopes.filter(s => s !== scope))} /><span>{scope}</span> — {scopeDescriptions[scope]}</Label>)}</fieldset>
      <Label>Expiry <Select value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map(days => <option key={days} value={days}>{days} days</option>)}</Select></Label>
      {create.error && <p role="alert">{create.error.message}</p>}
      <Button variant="primary" disabled={create.isPending || !scopes.length}>{create.isPending ? "Creating…" : "Create key"}</Button>
    </form>}
  </SettingsLayout>;
}
