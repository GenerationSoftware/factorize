import type { TraceEvent, TraceEventType } from "./trace";
import { safeDiagnosticText } from "./harness-diagnostics";

export type CodexCalls = Map<string, string>;
const safe = (value: unknown, limit = 32768) => safeDiagnosticText(typeof value === "string" ? value : JSON.stringify(value ?? ""), limit);
const argumentsValue = (value: unknown): unknown => {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return value; }
};

/** Raw exec events are self-contained snapshots; no tool state is needed across byte chunks. */
export function parseCodexExec(value: any, sequence: number): TraceEvent[] {
  const make = (type: TraceEventType, title: unknown, preview: unknown, id?: string, parentId?: string): TraceEvent => ({
    sequence, id: id ?? String(sequence), type, title: safe(title, 512), preview: safe(preview),
    ...(parentId ? { parentId } : {}), display: { source: "codex exec --json", eventType: safe(value?.type, 128) },
  });
  if (!value || typeof value !== "object") return [make("warning", "Invalid Codex event", "Expected a JSON object")];
  if (value.type === "turn.completed") return [make("usage", "Token usage", value.usage)];
  if (value.type === "error" || value.type === "turn.failed") return [make("error", "Codex error", value.message ?? value.error?.message ?? value.error)];
  if (value.type === "thread.started" || value.type === "turn.started") return [make("metadata", value.type, value.thread_id ?? "")];
  if (!["item.started", "item.updated", "item.completed"].includes(value.type)) return [make("metadata", "Unknown Codex event", { type: safe(value.type, 128) })];
  const item = value.item;
  if (!item || typeof item !== "object" || typeof item.id !== "string") return [make("warning", "Invalid Codex item", "Missing item identity")];
  const id = safe(item.id, 512), parent = typeof item.parent_id === "string" ? safe(item.parent_id, 512) : undefined;
  const completed = value.type === "item.completed";
  const recordId = `${id}:${value.type}`;
  const call = (title: unknown, args: unknown) => make("tool_call", title, argumentsValue(args), id, parent);
  const result = (title: unknown, output: unknown) => make("tool_result", title, output, recordId, id);
  switch (item.type) {
    case "reasoning": return [make("reasoning", "Reasoning", item.text, recordId, parent)];
    case "agent_message": return [make("assistant_message", "Assistant", item.text, recordId, parent)];
    case "command_execution":
      return completed ? [result(item.command ?? "Command result", { output: item.aggregated_output ?? "", exitCode: item.exit_code, status: item.status })]
        : [call(item.command ?? "Command", { command: item.command })];
    case "mcp_tool_call": {
      const title = `${item.server ?? "MCP"}: ${item.tool ?? "Tool"}`;
      return completed ? [result(title, item.error ?? item.result)] : [call(title, item.arguments)];
    }
    case "file_change":
      return [make("file_change", "File changes", { changes: item.changes, status: item.status }, recordId, parent)];
    case "web_search":
      return completed ? [result("Web search", item.action ?? item.query)] : [call("Web search", item.action ?? { query: item.query })];
    case "todo_list": return [make("metadata", "Plan", item.items, recordId, parent)];
    case "error": return [make("error", "Codex error", item.message, recordId, parent)];
    default: return [make("metadata", "Unknown Codex item", { type: safe(item.type, 128), status: safe(item.status, 128) }, recordId, parent)];
  }
}

export function parseCodexNativeCall(value: any, sequence: number, calls: CodexCalls): TraceEvent[] | null {
  const payload = value?.payload;
  if (value?.type !== "response_item" || !payload) return null;
  const kind = payload.type;
  if (!["function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"].includes(kind)) return null;
  const callId = safe(payload.call_id ?? payload.id ?? String(sequence), 512);
  const output = kind.endsWith("_output");
  const title = output ? calls.get(callId) ?? "Tool result" : safe(payload.name ?? "Tool call", 512);
  if (!output) {
    if (calls.size >= 4096) calls.delete(calls.keys().next().value!);
    calls.set(callId, title);
  }
  const preview = safe(output ? payload.output : argumentsValue(payload.arguments ?? payload.input));
  return [{ sequence, id: output ? `${callId}:result` : callId, ...(output ? { parentId: callId } : payload.parent_id ? { parentId: safe(payload.parent_id, 512) } : {}),
    type: output ? "tool_result" : "tool_call", title, preview,
    ...(typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp)) ? { occurredAt: value.timestamp } : {}),
    display: { source: "codex native session", ...(!output ? { arguments: argumentsValue(preview) } : {}) } }];
}
