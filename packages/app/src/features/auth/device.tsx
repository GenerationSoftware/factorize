import { Button, Input, Label, Page } from "../../shared/ui";
import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "./session";
export function DeviceScreen() {
  const search = useSearch({ strict: false }) as { user_code: string; connection?: string }, navigate = useNavigate(), [code, setCode] = useState(search.user_code);
  const preview = useQuery({ queryKey: ["device", search.user_code], enabled: !!search.user_code, queryFn: async ({ signal }) => { const { data, error } = await api.POST("/api/v1/oauth/device/preview", { signal, body: { userCode: search.user_code } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 0, retry: false });
  const decision = useMutation({ retry: false, mutationFn: async (value: "allow" | "deny") => { if (!preview.data) throw new Error("Review the device request first."); const { data, error } = await api.POST("/api/v1/oauth/device/decision", { body: { userCode: search.user_code, signature: preview.data!.signature, decision: value } }); if (!data || error) throw new Error(messageOf(error)); return data; } });
  return <Page className="my-8 flex-none max-w-xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><h1 className="text-3xl font-semibold">Connect a device</h1><p>Enter the code displayed by your MCP client. Only approve a request you started. If it expires, request a new code in that client.</p>{decision.data ? <p role="status">{decision.data.status === "approved" ? "Device connected" : "Authorization denied"}. You can close this window.</p> : <>
    <form className="my-4 grid gap-4" onSubmit={e => { e.preventDefault(); decision.reset(); void navigate({ to: "/device", search: { user_code: code, connection: undefined } }); }}><Label>Device code <Input required autoComplete="one-time-code" autoFocus placeholder="ABCD-2345" maxLength={32} value={code} onChange={e => setCode(e.target.value.toUpperCase())} /></Label><Button disabled={decision.isPending}>Continue</Button></form>
    {preview.isFetching && <p role="status">Validating device code…</p>}{preview.data && <><h2>Authorize {preview.data.clientName}</h2><p>Permissions: {preview.data.scopes.join(", ")} · Expires {preview.data.expiresAt}</p><Button variant="primary" disabled={decision.isPending} onClick={() => decision.mutate("allow")}>Allow device</Button><Button disabled={decision.isPending} onClick={() => decision.mutate("deny")}>Deny device</Button></>}
    {[preview.error, decision.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}</>}
  </Page>;
}
