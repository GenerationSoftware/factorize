import { Disclosure, Summary, Button, Select, Label } from "../../shared/ui";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function ReplayTrace({ runId }: { runId: string }) {
  const cache = useQueryClient(), [source, setSource] = useState<"primary" | "native_session">("primary"), [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const replay = useMutation({ retry: false, mutationFn: async () => { const { data, error } = await api.POST("/api/v1/runs/{runId}/trace/replay", { params: { path: { runId } }, body: { source, requestId } }); if (!data || error) throw new Error(messageOf(error)); return data; }, onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["runs", runId] }); setRequestId(crypto.randomUUID()); } });
  return <Disclosure className="my-4"><Summary>Replay trace</Summary><p>Rebuild the displayed trace from retained artifacts. Existing pages reset after a successful replay.</p><Label>Replay source <Select disabled={replay.isPending} value={source} onChange={e => { setSource(e.target.value as typeof source); setRequestId(crypto.randomUUID()); replay.reset(); }}><option value="primary">Primary</option><option value="native_session">Native session</option></Select></Label><Button disabled={replay.isPending} onClick={() => { if (window.confirm("Replay this run's retained trace?")) replay.mutate(); }}>Replay retained trace</Button>{replay.error && <p role="alert">{replay.error.message}</p>}{replay.data && <pre role="status" className="whitespace-pre-wrap break-words">{JSON.stringify(replay.data, null, 2)}</pre>}</Disclosure>;
}
