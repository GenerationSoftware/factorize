import Mustache from "mustache";
import { generateTailSecret, TAIL_HANDLER_SCAFFOLD } from "./cloudflare-tail";
import { prepareCustomHandler, validateCustomHandler } from "./custom-handler";
import { DEFAULT_CONTEXT_TEMPLATE, renderContextTemplate } from "./linear-source";
import type { CustomSource, FlowSource } from "./types";

export const TAIL_CONTEXT_TEMPLATE = `---
pipe: "{{{flow.name}}}"
source: "Cloudflare Tail"
delivery: "{{{deliveryId}}}"
---

# Cloudflare Worker Tail event

\`\`\`json
{{{eventJson}}}
\`\`\``;

export type PublicSource =
  | { kind: "linear"; projectId: string; matchRules: Array<{ type: "owner" | "creator" | "status" | "label" | "assignee"; targetId: string }> }
  | { kind: "cloudflareTail"; handlerCode?: string };

export function defaultContextTemplate(source: { kind: string }): string {
  return source.kind === "cloudflareTail" ? TAIL_CONTEXT_TEMPLATE : DEFAULT_CONTEXT_TEMPLATE;
}

export function resolveContextTemplate(source: { kind: string }, value?: string): string {
  const template = value || defaultContextTemplate(source);
  if (template.length > 50_000) throw new Error("Context template must be 50,000 characters or fewer.");
  try { Mustache.parse(template); } catch { throw new Error("Context template contains invalid Mustache syntax."); }
  return template;
}

export function renderSourcePrompt(source: FlowSource, template: string, payload: Record<string, unknown>, flowName: string, deliveryId?: string): string {
  if (source.kind === "custom" && source.origin === "cloudflare") return Mustache.render(template, { event: payload, eventJson: JSON.stringify(payload, null, 2), deliveryId, flow: { name: flowName } });
  return renderContextTemplate(template, payload, flowName);
}

export async function preparePublicSource(tenantId: string, flowId: string, source: PublicSource, previous?: FlowSource, signingSecret?: string): Promise<FlowSource> {
  if (source.kind === "linear") return source;
  const handlerCode = source.handlerCode ?? TAIL_HANDLER_SCAFFOLD;
  const valid = validateCustomHandler("cloudflare", "Cloudflare Worker failures", handlerCode);
  const old = previous?.kind === "custom" && previous.origin === "cloudflare" ? previous as CustomSource : undefined;
  const secret = signingSecret ?? old?.tail?.signingSecret ?? generateTailSecret();
  if (secret.length < 32 || secret.length > 256) throw new Error("Cloudflare Tail signing secret must be between 32 and 256 characters.");
  return prepareCustomHandler(tenantId, flowId, { kind: "custom", ...valid, tail: { signingSecret: secret } }, old);
}

export function publicSource(source: FlowSource): PublicSource {
  return source.kind === "custom" && source.origin === "cloudflare"
    ? { kind: "cloudflareTail", handlerCode: source.handlerCode }
    : source as PublicSource;
}
