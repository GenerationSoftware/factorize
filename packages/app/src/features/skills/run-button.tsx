import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button } from "../../shared/ui";
import { messageOf } from "../auth/session";

export function RunSkillButton({ skillId, name, disabled = false }: { skillId: string; name: string; disabled?: boolean }) {
  const navigate = useNavigate(), attempt = useRef<string | null>(null);
  const launch = useMutation({ retry: false, mutationFn: async () => {
    attempt.current ??= crypto.randomUUID();
    const { data, error } = await api.POST("/api/v1/runs", { body: { skill: skillId, idempotencyKey: attempt.current } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  }, onSuccess: receipt => navigate({ to: "/runs/$runId", params: { runId: receipt.runId }, search: { after: 0 } }) });
  return <div className="min-w-0"><Button variant="primary" aria-label={`Run ${name}`} title={disabled ? "This skill is disabled" : `Run ${name}`} disabled={disabled || launch.isPending} onClick={() => launch.mutate()}>{launch.isPending ? "Starting…" : "Run"}</Button>{launch.error && <p role="alert" className="mt-2 max-w-xs whitespace-normal text-left text-xs">{launch.error.message}</p>}</div>;
}
