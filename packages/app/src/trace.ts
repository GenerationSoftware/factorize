export type TraceEventType = "user_message" | "assistant_message" | "reasoning" | "tool_call" | "tool_result" | "command" | "file_change" | "compaction" | "branch" | "usage" | "warning" | "error" | "metadata";

export interface TraceEvent {
  sequence: number;
  id: string;
  parentId?: string;
  type: TraceEventType;
  role?: string;
  title: string;
  preview: string;
  occurredAt?: string;
  display: Record<string, unknown>;
}

const MAX_PREVIEW = 32_768;
const clipped = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length <= MAX_PREVIEW ? text : `${text.slice(0, MAX_PREVIEW)}\n… output truncated in trace view`;
};
const contentText = (content: unknown): string => Array.isArray(content)
  ? content.map(item => item && typeof item === "object" ? String((item as any).text ?? (item as any).thinking ?? "") : String(item ?? "")).filter(Boolean).join("\n")
  : clipped(content);

function event(sequence: number, type: TraceEventType, title: string, preview: unknown, source: any): TraceEvent {
  return { sequence, id: String(source.id ?? source.uuid ?? `${sequence}`), ...(source.parentId || source.parentUuid ? { parentId: String(source.parentId ?? source.parentUuid) } : {}), type, ...(source.role ? { role: String(source.role) } : {}), title, preview: clipped(preview), ...(source.timestamp ? { occurredAt: String(source.timestamp) } : {}), display: {} };
}

function parsePi(value: any, sequence: number): TraceEvent[] {
  if (value.type === "session") return [event(sequence, "metadata", "Session started", value.cwd ?? "", value)];
  if (value.type === "compaction") return [event(sequence, "compaction", "Context compacted", value.summary, value)];
  if (value.type === "branch_summary") return [event(sequence, "branch", "Branch summary", value.summary, value)];
  if (value.type !== "message") return [event(sequence, "metadata", String(value.type ?? "Event"), value, value)];
  const message = value.message ?? {}, role = message.role;
  if (role === "user") return [event(sequence, "user_message", "User", contentText(message.content), { ...value, role })];
  if (role === "toolResult") return [event(sequence, "tool_result", String(message.toolName ?? "Tool result"), contentText(message.content), { ...value, role })];
  if (role === "bashExecution") return [event(sequence, "command", String(message.command ?? "Command"), message.output, { ...value, role })];
  if (role === "assistant") {
    const entries: TraceEvent[] = [];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === "thinking") entries.push(event(sequence + entries.length, "reasoning", "Reasoning", block.thinking, { ...value, role }));
      else if (block.type === "toolCall") entries.push({ ...event(sequence + entries.length, "tool_call", String(block.name ?? "Tool call"), block.arguments, { ...value, id: block.id, role }), display: { arguments: block.arguments ?? {} } });
      else if (block.type === "text") entries.push(event(sequence + entries.length, "assistant_message", "Assistant", block.text, { ...value, role }));
    }
    return entries.length ? entries : [event(sequence, "assistant_message", "Assistant", contentText(message.content), { ...value, role })];
  }
  return [event(sequence, "metadata", String(role ?? "Message"), message.content, { ...value, role })];
}

function parseCodex(value: any, sequence: number): TraceEvent[] {
  const payload = value.payload ?? {};
  if (value.type === "session_meta") return [event(sequence, "metadata", "Session started", payload.cwd ?? "", { ...value, id: payload.id ?? payload.session_id })];
  if (value.type === "response_item") {
    const kind = payload.type;
    if (kind === "message") return [event(sequence, payload.role === "user" ? "user_message" : "assistant_message", payload.role === "user" ? "User" : "Assistant", contentText(payload.content), { ...value, ...payload })];
    if (kind === "function_call") return [{ ...event(sequence, "tool_call", String(payload.name ?? "Tool call"), payload.arguments, { ...value, ...payload }), display: { arguments: payload.arguments ?? {} } }];
    if (kind === "function_call_output") return [event(sequence, "tool_result", "Tool result", payload.output, { ...value, ...payload })];
    if (kind === "reasoning") return [event(sequence, "reasoning", "Reasoning", contentText(payload.summary ?? payload.content), { ...value, ...payload })];
  }
  if (value.type === "event_msg" && payload.type === "agent_reasoning") return [event(sequence, "reasoning", "Reasoning", payload.text, { ...value, ...payload })];
  return [];
}

function parseClaude(value: any, sequence: number): TraceEvent[] {
  const message = value.message ?? value;
  if (value.type === "user" || message.role === "user") {
    const toolResult = Array.isArray(message.content) && message.content.find((x: any) => x?.type === "tool_result");
    return [event(sequence, toolResult ? "tool_result" : "user_message", toolResult ? "Tool result" : "User", contentText(toolResult?.content ?? message.content), value)];
  }
  if (value.type === "assistant" || message.role === "assistant") {
    const entries: TraceEvent[] = [];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === "thinking") entries.push(event(sequence + entries.length, "reasoning", "Reasoning", block.thinking, value));
      else if (block.type === "tool_use") entries.push({ ...event(sequence + entries.length, "tool_call", String(block.name ?? "Tool call"), block.input, { ...value, id: block.id }), display: { arguments: block.input ?? {} } });
      else if (block.type === "text") entries.push(event(sequence + entries.length, "assistant_message", "Assistant", block.text, value));
    }
    return entries;
  }
  return value.type === "summary" ? [event(sequence, "compaction", "Context summary", value.summary, value)] : [];
}

/** Parses a native JSONL artifact into bounded, provider-neutral display events. */
export function parseTrace(provider: "codex" | "claude" | "pi", jsonl: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { events.push(event(events.length + 1, "warning", "Unparseable session record", line, {})); continue; }
    const parsed = provider === "codex" ? parseCodex(value, events.length + 1) : provider === "claude" ? parseClaude(value, events.length + 1) : parsePi(value, events.length + 1);
    events.push(...parsed);
  }
  return events.map((item, index) => ({ ...item, sequence: index + 1 }));
}

/** Incrementally parses JSONL without loading the native artifact as one string. */
export async function parseTraceStream(provider: "codex" | "claude" | "pi", stream: ReadableStream<Uint8Array>): Promise<TraceEvent[]> {
  const reader = stream.getReader(), decoder = new TextDecoder(), events: TraceEvent[] = [];
  let pending = "";
  const consume = (line: string) => {
    if (!line.trim()) return;
    const parsed = parseTrace(provider, line);
    for (const item of parsed) events.push({ ...item, sequence: events.length + 1 });
  };
  for (;;) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
    if (done) break;
    if (pending.length > 16 * 1024 * 1024) { events.push(event(events.length + 1, "warning", "Oversized session record", "A native JSONL record exceeded the 16 MiB trace parsing limit.", {})); pending = ""; }
  }
  consume(pending);
  return events;
}
