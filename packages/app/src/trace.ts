import { safeDiagnosticText } from "./harness-diagnostics";
import { parseCodexExec, parseCodexNativeCall, type CodexCalls } from "./codex-trace";
import { parsePi } from "./pi-trace";
import type { TraceSource } from "./trace-source";
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

function parseCodex(value: any, sequence: number): TraceEvent[] {
  if (!value || typeof value !== "object") return [event(sequence, "warning", "Invalid Codex record", "Expected an object", {})];
  const payload = value.payload ?? {};
  if (value.type === "session_meta") return [event(sequence, "metadata", "Session started", safeDiagnosticText(String(payload.cwd ?? ""), MAX_PREVIEW), { ...value, id: payload.id ?? payload.session_id })];
  if (value.type === "response_item") {
    const kind = payload.type;
    if (kind === "message") return [event(sequence, payload.role === "user" ? "user_message" : "assistant_message", payload.role === "user" ? "User" : "Assistant", safeDiagnosticText(contentText(payload.content), MAX_PREVIEW), { ...value, ...payload })];
    if (kind === "function_call") return [{ ...event(sequence, "tool_call", String(payload.name ?? "Tool call"), payload.arguments, { ...value, ...payload }), display: { arguments: payload.arguments ?? {} } }];
    if (kind === "function_call_output") return [event(sequence, "tool_result", "Tool result", payload.output, { ...value, ...payload })];
    if (kind === "reasoning") return [event(sequence, "reasoning", "Reasoning", safeDiagnosticText(contentText(payload.summary ?? payload.content), MAX_PREVIEW), { ...value, ...payload })];
  }
  if (value.type === "event_msg" && payload.type === "agent_reasoning") return [event(sequence, "reasoning", "Reasoning", safeDiagnosticText(String(payload.text ?? ""), MAX_PREVIEW), { ...value, ...payload })];
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

/** Parses source JSONL into bounded, provider-neutral display events. */
export function parseTrace(provider: "codex" | "claude" | "pi", jsonl: string, sourceKind: TraceSource["kind"] = "native_session", startSequence = 1, calls: CodexCalls = new Map()): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { if (sourceKind === "execution_stream" && provider !== "codex") throw new Error("Invalid execution stream JSON"); events.push(event(startSequence + events.length, "warning", "Unparseable session record", provider === "codex" ? "Invalid JSON record skipped" : line, {})); continue; }
    if (sourceKind === "execution_stream" && provider === "codex" && (value as any)?.version !== 1) {
      events.push(...parseCodexExec(value, startSequence + events.length));
      continue;
    }
    if (sourceKind === "execution_stream") {
      const record = value as any;
      if (!record || record.version !== 1 || typeof record.id !== "string" || typeof record.title !== "string" || typeof record.preview !== "string" || !["user_message", "assistant_message", "reasoning", "tool_call", "tool_result", "command", "file_change", "compaction", "branch", "usage", "warning", "error", "metadata"].includes(record.type)) throw new Error("Invalid execution stream record");
      if (record.occurredAt !== undefined && (typeof record.occurredAt !== "string" || !Number.isFinite(Date.parse(record.occurredAt)))) throw new Error("Invalid execution stream timestamp");
      events.push({ sequence: events.length + 1, id: record.id, type: record.type, title: clipped(record.title), preview: clipped(record.preview), ...(typeof record.parentId === "string" ? { parentId: record.parentId } : {}), ...(typeof record.role === "string" ? { role: record.role } : {}), ...(typeof record.occurredAt === "string" ? { occurredAt: record.occurredAt } : {}), display: record.display && typeof record.display === "object" && !Array.isArray(record.display) ? record.display : {} });
      continue;
    }
    const parsed = provider === "codex" ? parseCodexNativeCall(value, startSequence + events.length, calls) ?? parseCodex(value, startSequence + events.length) : provider === "claude" ? parseClaude(value, events.length + 1) : parsePi(value, events.length + 1);
    events.push(...(provider === "codex" ? parsed.map(item => ({ ...item, title: safeDiagnosticText(item.title, 512), preview: safeDiagnosticText(item.preview, MAX_PREVIEW) })) : parsed));
  }
  return events.map((item, index) => ({ ...item, sequence: startSequence + index }));
}

/** Byte framing matches live ingestion, including an incomplete UTF-8 tail at exit. */
async function consumeExecutionStream(provider: "codex" | "claude" | "pi", stream: ReadableStream<Uint8Array>, consumeBatch: (events: TraceEvent[]) => Promise<void>, batchSize: number): Promise<number> {
  const reader = stream.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = new Uint8Array(), sequence = 0, batch: TraceEvent[] = [];
  const flush = async () => { if (batch.length) { const ready = batch; batch = []; await consumeBatch(ready); } };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break; // Preserve, but never project, an unterminated record.
      const combined = new Uint8Array(pending.length + value.length);
      combined.set(pending); combined.set(value, pending.length);
      let start = 0;
      for (let index = 0; index < combined.length; index++) {
        if (combined[index] !== 10) continue;
        if (index - start > 16 * 1024 * 1024) throw new Error("Execution stream record exceeds 16 MiB");
        const events = parseTrace(provider, decoder.decode(combined.subarray(start, index)), "execution_stream", sequence + 1);
        for (const item of events) { batch.push({ ...item, sequence: ++sequence }); if (batch.length >= batchSize) await flush(); }
        start = index + 1;
      }
      pending = combined.slice(start);
      if (pending.length > 16 * 1024 * 1024) throw new Error("Execution stream record exceeds 16 MiB");
    }
    await flush();
    return sequence;
  } finally { reader.releaseLock(); }
}

/** Incrementally parses JSONL and emits bounded batches without loading the artifact or projection in full. */
export async function consumeTraceStream(provider: "codex" | "claude" | "pi", stream: ReadableStream<Uint8Array>, consumeBatch: (events: TraceEvent[]) => Promise<void>, batchSize = 250, sourceKind: TraceSource["kind"] = "native_session"): Promise<number> {
  if (sourceKind === "execution_stream") return consumeExecutionStream(provider, stream, consumeBatch, batchSize);
  const reader = stream.getReader(), decoder = new TextDecoder();
  let batch: TraceEvent[] = [], sequence = 0;
  let pending = "";
  const calls: CodexCalls = new Map();
  const flush = async () => { if (!batch.length) return; const ready = batch; batch = []; await consumeBatch(ready); };
  const consume = async (line: string) => {
    if (!line.trim()) return;
    const parsed = parseTrace(provider, line, sourceKind, sequence + 1, calls);
    for (const item of parsed) { batch.push({ ...item, sequence: ++sequence }); if (batch.length >= batchSize) await flush(); }
  };
  for (;;) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) { await consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
    if (done) break;
    if (pending.length > 16 * 1024 * 1024) { batch.push(event(++sequence, "warning", "Oversized session record", "A native JSONL record exceeded the 16 MiB trace parsing limit.", {})); pending = ""; if (batch.length >= batchSize) await flush(); }
  }
  await consume(pending);
  await flush();
  return sequence;
}

/** Convenience collector for tests and bounded callers. Production ingestion uses consumeTraceStream. */
export async function parseTraceStream(provider: "codex" | "claude" | "pi", stream: ReadableStream<Uint8Array>): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  await consumeTraceStream(provider, stream, async batch => { events.push(...batch); });
  return events;
}
