import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function DeleteJob({ jobId, name }: { jobId: string; name: string }) {
  const cache = useQueryClient(), navigate = useNavigate();
  const remove = useMutation({ retry: false, mutationFn: async () => { const { error } = await api.DELETE("/api/v1/jobs/{jobId}", { params: { path: { jobId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["jobs"] }); await cache.invalidateQueries({ queryKey: ["runs"] }); void navigate({ to: "/jobs", search: { q: "" } }); } });
  return <section className="my-6"><button disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${name} and its execution history and artifacts? This cannot be undone.`)) remove.mutate(); }}>Delete job</button>{remove.error && <p role="alert">{remove.error.message}</p>}</section>;
}
