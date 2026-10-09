import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
import type { Trigger } from "./editor-state";
type Conditions = Extract<Trigger, { kind: "webhook" }>["config"]["conditions"];
export function ConditionsEditor({ conditions, onChange }: { conditions: Conditions; onChange: (value: Conditions) => void }) {
  const [text, setText] = useState(() => conditions === undefined ? "" : JSON.stringify(conditions, null, 2));
  const [webhook, setWebhook] = useState("{}"), [invalid, setInvalid] = useState("");
  useEffect(() => { setText(conditions === undefined ? "" : JSON.stringify(conditions, null, 2)); setInvalid(""); }, [conditions]);
  const test = useMutation({ retry: false, mutationFn: async () => {
    const example: unknown = JSON.parse(webhook);
    if (!example || typeof example !== "object" || Array.isArray(example)) throw new Error("Example webhook must be a JSON object.");
    const { data, error } = await api.POST("/api/v1/job-conditions/test", { body: { conditions: text.trim() ? JSON.parse(text) : undefined, webhook: example as Record<string, never> } });
    if (!data || error) throw new Error(messageOf(error)); return data;
  } });
  return <div className="grid gap-3"><label>Conditions JSON (optional) <textarea maxLength={16_384} rows={8} value={text} onChange={e => {
    const value = e.target.value; setText(value); test.reset();
    try { const parsed = value.trim() ? JSON.parse(value) : undefined; setInvalid(""); onChange(parsed); }
    catch { setInvalid("Conditions must be valid JSON before saving."); }
  }} ref={element => element?.setCustomValidity(invalid)} /></label>
    {invalid && <p role="alert">{invalid}</p>}<p>Empty conditions add no filtering. Conditions only decide whether to invoke; prompt context stays intact.</p>
    <details><summary>Test webhook conditions</summary><p>Supply the prepared context the job would receive. This preview does not authenticate, route events, verify live GitHub state, or invoke jobs.</p>
      <label>Example webhook JSON <textarea rows={8} value={webhook} onChange={e => { setWebhook(e.target.value); test.reset(); }} /></label>
      <button type="button" disabled={test.isPending || Boolean(invalid)} onClick={() => test.mutate()}>Test conditions</button>
      {test.error && <p role="alert">{test.error.message}</p>}{test.data && <pre role="status" className="whitespace-pre-wrap break-words">{JSON.stringify(test.data, null, 2)}</pre>}
    </details></div>;
}
