import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "./session";
export function DeviceScreen() {
  const search = useSearch({ strict: false }) as { user_code: string }, navigate = useNavigate(), [code, setCode] = useState(search.user_code);
  const preview = useQuery({ queryKey: ["device", search.user_code], enabled: !!search.user_code, queryFn: async ({ signal }) => { const { data, error } = await api.POST("/api/v1/oauth/device/preview", { signal, body: { userCode: search.user_code } }); if (!data || error) throw new Error(messageOf(error)); return data; }, staleTime: 0, retry: false });
  const decision = useMutation({ retry: false, mutationFn: async (value: "allow" | "deny") => { const { data, error } = await api.POST("/api/v1/oauth/device/decision", { body: { userCode: search.user_code, decision: value } }); if (!data || error) throw new Error(messageOf(error)); return data; } });
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-3xl font-semibold">Connect a device</h1>{decision.data ? <p role="status">{decision.data.status === "approved" ? "Device connected" : "Authorization denied"}. You can close this window.</p> : <>
    <form className="my-4" onSubmit={e => { e.preventDefault(); decision.reset(); void navigate({ to: "/device", search: { user_code: code } }); }}><label>Device code <input required autoComplete="one-time-code" maxLength={32} value={code} onChange={e => setCode(e.target.value)} /></label><button disabled={decision.isPending}>Continue</button></form>
    {preview.isFetching && <p role="status">Validating device code…</p>}{preview.data && <><h2>Authorize {preview.data.clientName}</h2><p>Permissions: {preview.data.scopes.join(", ")} · Expires {preview.data.expiresAt}</p><button disabled={decision.isPending} onClick={() => decision.mutate("allow")}>Allow device</button><button disabled={decision.isPending} onClick={() => decision.mutate("deny")}>Deny device</button></>}
    {[preview.error, decision.error].filter(Boolean).map((error, i) => <p role="alert" key={i}>{error?.message}</p>)}</>}
  </main>;
}
