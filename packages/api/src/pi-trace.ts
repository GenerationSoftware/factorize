import type { TraceEvent, TraceEventType } from "./trace";

/** The exe.dev Pi binary and its published session contract, not stdout events. */
export const PI_CLI_VERSION = "1.1.0";
export const PI_SESSION_VERSION = "3";
const LIMIT = 32_768;
const clip = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length <= LIMIT ? text : text.slice(0, LIMIT) + "\n… output truncated in trace view";
};
const object = (value: any): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/** Bound arbitrary extension payloads; omit binary images and opaque replay signatures. */
function safe(value: any, depth = 0): any {
  if (typeof value === "string") return clip(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 6) return "[nested metadata omitted]";
  if (Array.isArray(value)) return value.slice(0, 64).map(item => safe(item, depth + 1));
  if (value.type === "image") return { type: "image", mimeType: clip(value.mimeType), omitted: true };
  return Object.fromEntries(Object.entries(value).slice(0, 64).filter(([key]) => !["thinkingSignature", "thoughtSignature", "textSignature"].includes(key)).map(([key, item]) => [clip(key), safe(item, depth + 1)]));
}
function bounded(value: any): any {
  const result = safe(value);
  const json = JSON.stringify(result ?? null);
  return json.length <= LIMIT ? result : { truncated: true, preview: clip(json) };
}
const text = (content: any): string => Array.isArray(content)
  ? clip(content.map(block => object(block) ? block.type === "image" ? `[Image: ${clip(block.mimeType)}; binary omitted]` : block.text ?? block.thinking ?? `[Content block: ${clip(block.type)}]` : "").join("\n"))
  : clip(content);

/** Each derived event retains the native entry ID/parent; tool IDs are separate links. */
export function parsePi(input: any, sequence: number): TraceEvent[] {
  const value = object(input) ? input : { type: "invalid_record", data: input };
  const message = object(value.message) ? value.message : {};
  const provenance = {
    entryType: value.type ?? "unknown", entryId: value.id ?? null,
    parentId: value.parentId ?? null, timestamp: value.timestamp ?? null,
    ...(message.timestamp !== undefined ? { messageTimestamp: message.timestamp } : {}),
  };
  const make = (type: TraceEventType, title: string, preview: any, extra: Record<string, unknown> = {}): TraceEvent => ({
    sequence, id: String(value.id ?? `pi:${sequence}`),
    ...(typeof value.parentId === "string" ? { parentId: value.parentId } : {}),
    type, title: clip(title), preview: clip(preview),
    ...(typeof message.role === "string" ? { role: message.role } : {}),
    ...(typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp)) ? { occurredAt: value.timestamp } : {}),
    display: { ...bounded(provenance), ...extra },
  });
  const metadata = (title: string, record: any = value) => make("metadata", title, bounded(record), { metadata: bounded(record) });
  if (value.type === "session") return [make("metadata", "Session started", value.cwd ?? "", {
    version: value.version ?? 1, cwd: clip(value.cwd), parentSession: value.parentSession ? clip(value.parentSession) : null,
    compatibility: value.version === 3 ? "supported" : "best_effort_unmigrated",
  })];
  if (value.type === "compaction" || value.type === "branch_summary") return [make(value.type === "compaction" ? "compaction" : "branch", value.type === "compaction" ? "Context compacted" : "Branch summary", value.summary, {
    firstKeptEntryId: value.firstKeptEntryId ?? null, fromId: value.fromId ?? null,
    tokensBefore: value.tokensBefore, fromHook: value.fromHook, details: bounded(value.details),
    usage: bounded(value.usage), systemMessage: bounded(value.systemMessage),
  })];
  if (value.type === "usage") return [make("usage", `Usage: ${clip(value.kind)}`, bounded(value.usage), { kind: clip(value.kind), provider: clip(value.provider), model: clip(value.model), usage: bounded(value.usage) })];
  const titles: Record<string, string> = { model_change: "Model changed", thinking_level_change: "Thinking level changed", custom: "Custom entry", custom_message: "Custom message", label: "Entry label", session_info: "Session info", context_edit: "Context edited" };
  if (value.type !== "message") return [metadata(Object.hasOwn(titles, value.type) ? titles[value.type]! : `Unknown entry: ${clip(value.type)}`)];
  const role = message.role;
  if (role === "user") return [make("user_message", "User", text(message.content))];
  if (role === "toolResult") return [make("tool_result", message.toolName ?? "Tool result", text(message.content), {
    toolCallId: message.toolCallId, isError: message.isError, details: bounded(message.details),
    usage: bounded(message.usage), nestedCalls: bounded(message.nestedCalls),
  })];
  if (role === "bashExecution") return [make("command", message.command ?? "Command", message.output, {
    exitCode: message.exitCode, cancelled: message.cancelled, truncated: message.truncated,
    fullOutputPath: message.fullOutputPath ? clip(message.fullOutputPath) : undefined, excludeFromContext: message.excludeFromContext,
  })];
  if (role === "branchSummary" || role === "compactionSummary") return [make(role === "branchSummary" ? "branch" : "compaction", role === "branchSummary" ? "Branch summary" : "Context compacted", message.summary, { fromId: message.fromId, tokensBefore: message.tokensBefore })];
  if (role !== "assistant") return [metadata(role === "system" ? "System prompt changed" : role === "custom" || role === "hookMessage" ? "Custom message" : `Unknown message role: ${clip(role)}`, message)];
  const entries: TraceEvent[] = [];
  for (const [blockIndex, block] of (Array.isArray(message.content) ? message.content : []).entries()) {
    const extra = { blockIndex, provider: clip(message.provider), model: clip(message.model), thinkingLevel: message.thinkingLevel, stopReason: message.stopReason };
    if (!object(block)) { entries.push(metadata("Invalid content block", block)); continue; }
    if (block.type === "thinking") entries.push(make("reasoning", "Reasoning", block.redacted ? "[Redacted thinking]" : block.thinking, { ...extra, redacted: block.redacted }));
    else if (block.type === "toolCall") entries.push(make("tool_call", block.name ?? "Tool call", bounded(block.arguments ?? {}), { ...extra, toolCallId: block.id, namespace: block.namespace, arguments: bounded(block.arguments ?? {}) }));
    else if (block.type === "text") entries.push(make("assistant_message", "Assistant", block.text, extra));
    else entries.push(make("metadata", `Unknown content block: ${clip(block.type)}`, bounded(block), { ...extra, metadata: bounded(block) }));
  }
  if (!entries.length) entries.push(make("assistant_message", "Assistant", text(message.content)));
  if (message.usage) entries.push(make("usage", "Model usage", bounded(message.usage), { provider: clip(message.provider), model: clip(message.model), usage: bounded(message.usage) }));
  if (message.errorMessage || ["error", "aborted"].includes(message.stopReason)) entries.push(make(message.stopReason === "error" ? "error" : "warning", "Assistant " + message.stopReason, message.errorMessage ?? message.stopReason));
  return entries.map((entry, index) => ({ ...entry, sequence: sequence + index }));
}
