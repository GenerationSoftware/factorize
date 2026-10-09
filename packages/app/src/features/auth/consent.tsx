import { Button, Input, Label, Page } from "../../shared/ui";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "./session";
export function ConsentScreen() {
  const authorizationQuery = location.search.slice(1), [selected, setSelected] = useState<string[] | null>(null);
  const preview = useQuery({ queryKey: ["consent", authorizationQuery], queryFn: async ({ signal }) => { const { data, error } = await api.POST("/api/v1/oauth/consent/preview", { signal, body: { authorizationQuery } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 0, retry: false });
  const decision = useMutation({ retry: false, mutationFn: async (value: "allow" | "deny") => { if (!preview.data) throw new Error("Load the authorization request first."); const { data, error } = await api.POST("/api/v1/oauth/consent/decision", { body: { request: preview.data.request, signature: preview.data.signature, decision: value, scopes: (selected ?? preview.data.scopes) as ("flows:read" | "flows:write" | "runs:read" | "runs:write")[] } }); if (!data || error) throw new Error(messageOf(error)); location.assign(data.redirectTo); } });
  const scopes = selected ?? preview.data?.scopes ?? [];
  return <Page className="my-8 flex-none max-w-xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h1 className="text-3xl font-semibold">Authorize {preview.data?.clientName ?? "a client"}</h1>{preview.isPending && <p role="status">Validating authorization request…</p>}{preview.error && <p role="alert">{preview.error.message}</p>}
    {preview.data && <><p>This client requests access to your workspace. Request expires {preview.data.expiresAt}.</p><fieldset><legend>Permissions</legend>{preview.data.scopes.map(scope => <Label className="block" key={scope}><Input type="checkbox" checked={scopes.includes(scope)} onChange={e => setSelected(e.target.checked ? [...scopes, scope] : scopes.filter(s => s !== scope))} />{scope}</Label>)}</fieldset><Button variant="primary" disabled={decision.isPending} onClick={() => decision.mutate("allow")}>Allow</Button><Button disabled={decision.isPending} onClick={() => decision.mutate("deny")}>Deny</Button></>}{decision.error && <p role="alert">{decision.error.message}</p>}
  </Page>;
}
