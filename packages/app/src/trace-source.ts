import { shellAtom } from "./exe";

/** A guest file, never a terminal log. Execution streams use Factorize JSONL v1 or declared provider stdout JSONL. */
export interface TraceSource {
  kind: "execution_stream" | "native_session";
  path: string;
  mediaType: "application/x-ndjson";
  provider: "codex" | "claude" | "pi";
  formatVersion?: string;
  cliVersion?: string;
  harnessVersion?: string;
  /** Native sessions may require discovery; execution streams always use path. */
  discoverCommand?: string;
}
export interface TraceSources { primary: TraceSource; nativeSession?: TraceSource; }
export function sourceCommand(source: TraceSource): string {
  if (source.kind === "native_session" && source.discoverCommand) return source.discoverCommand;
  if (!source.path.startsWith("/") || source.path.includes("\n") || source.path.includes("\0") || source.path.split("/").some(part => part === ".." || part === ".")) throw new Error("Trace source requires an absolute guest path");
  return `printf '%s' ${shellAtom(source.path)}`;
}
export function validateTraceSources(sources: TraceSources): void {
  for (const source of [sources.primary, sources.nativeSession].filter(Boolean) as TraceSource[]) {
    sourceCommand(source);
    if (source.mediaType !== "application/x-ndjson") throw new Error("Trace sources must be JSONL");
    if (!["execution_stream", "native_session"].includes(source.kind) || !["codex", "claude", "pi"].includes(source.provider)) throw new Error("Invalid trace source");
    if (source.kind === "execution_stream" && source.formatVersion && source.formatVersion !== "1" && !(source.provider === "codex" && source.formatVersion === "codex-exec-jsonl")) throw new Error("Unsupported execution stream version");
  }
  if (sources.primary.kind === "execution_stream" && ["/tmp/factorize.log", "/tmp/factorize.stderr", "/tmp/factorize-prompt.md"].includes(sources.primary.path)) throw new Error("Trace stream path is reserved for JSONL only");
  if (sources.nativeSession) {
    sourceCommand(sources.nativeSession);
    if (sources.nativeSession.kind !== "native_session" || sources.nativeSession.path === sources.primary.path && sources.primary.kind === "execution_stream") throw new Error("Native session must be separate from the execution stream");
  }
}
