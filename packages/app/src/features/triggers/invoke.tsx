import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Label, Textarea } from "../../shared/ui";
import { messageOf } from "../auth/session";
export function FireTrigger({ triggerId, enabled }: { triggerId: string; enabled: boolean }) {
  const cache = useQueryClient(), retry = useRef<{ body: string; key: string } | undefined>(undefined); const [parseError, setParseError] = useState("");
  const fire = useMutation({ retry: false, mutationFn: async (data: Record<string, unknown>) => {
    const body = JSON.stringify(data); if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    const result = await api.POST("/api/v1/triggers/{triggerId}/fire", { params: { path: { triggerId } }, body: { data, idempotencyKey: retry.current.key } });
    if (!result.data || result.error) throw new Error(messageOf(result.error)); return result.data;
  }, onSuccess: async result => { retry.current = undefined; await cache.invalidateQueries({ queryKey: ["events"] }); fire.reset(); if (result.duplicate) fire.reset(); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setParseError(""); try { const raw = new FormData(event.currentTarget).get("data")?.toString().trim() ?? "{}"; const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); fire.mutate(value); } catch { setParseError("Enter a JSON object as Event data."); } }
  return <form className="grid gap-2" onSubmit={submit}><Label>Publish manual occurrence (JSON)<Textarea name="data" defaultValue="{}" /></Label><Button variant="primary" disabled={!enabled || fire.isPending}>{fire.isPending ? "Publishing…" : "Fire Trigger"}</Button>{(parseError || fire.error) && <p role="alert">{parseError || fire.error?.message}</p>}{fire.isSuccess && <p role="status">Occurrence {fire.data?.occurrenceId ?? "was already recorded"}.</p>}</form>;
}
