import { Disclosure, Summary, Button, Textarea, Label } from "../../shared/ui";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function HandlerTest({ handlerCode }: { handlerCode: string }) {
  const [payload, setPayload] = useState("{}");
  const test = useMutation({ retry: false, mutationFn: async () => {
    let value: unknown; try { value = JSON.parse(payload); } catch { throw new Error("Enter a valid JSON webhook object."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Webhook payload must be an object.");
    const { data, error } = await api.POST("/api/v1/job-handlers/test", { body: { handlerCode, payload: value as Record<string, unknown> } }); if (!data || error) throw new Error(messageOf(error)); return data;
  } });
  return <Disclosure><Summary>Test webhook handler</Summary><Label>Sample webhook JSON <Textarea rows={5} value={payload} onChange={e => setPayload(e.target.value)} /></Label><Button type="button" disabled={test.isPending || !handlerCode} onClick={() => test.mutate()}>Test handler</Button>{test.error && <p role="alert">{test.error.message}</p>}{test.data && <pre role="status" className="whitespace-pre-wrap break-words">{JSON.stringify(test.data, null, 2)}</pre>}</Disclosure>;
}
