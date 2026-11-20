import { Button, Card } from "../../shared/ui";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function DeleteTrigger({ triggerId, name, disabled = false, onDeleted }: { triggerId: string; name: string; disabled?: boolean; onDeleted?: () => void }) {
  const cache = useQueryClient(), navigate = useNavigate();
  const remove = useMutation({ retry: false, mutationFn: async () => { const { error } = await api.DELETE("/api/v1/triggers/{triggerId}", { params: { path: { triggerId } } }); if (error) throw new Error(messageOf(error)); }, onSuccess: async () => { onDeleted?.(); await cache.invalidateQueries({ queryKey: ["triggers"] }); await cache.invalidateQueries({ queryKey: ["runs"] }); void navigate({ to: "/triggers", search: { q: "" } }); } });
  return <Card className="my-6"><h2 className="text-base">Delete this trigger</h2><p className="mb-4 text-sm text-slate-600 dark:text-slate-400">Remove this template and its events. Existing runs follow their usual retention period.</p><Button variant="destructive" disabled={disabled || remove.isPending} onClick={() => { if (window.confirm(`Delete ${name} and its events? This cannot be undone.`)) remove.mutate(); }}>Delete trigger</Button>{remove.error && <p role="alert">{remove.error.message}</p>}</Card>;
}
