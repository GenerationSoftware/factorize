import type { TraceSources } from "./trace-source";
export type AgentKind = "codex" | "claude" | "pi";

export interface AgentConfiguration { model?: string; effort?: string; }
export interface ArtifactLocator {
  /** Paths are interpreted inside the guest; the compute backend only transports files. */
  roots: string[];
  fileNameIncludes: string;
  sessionId?: string;
  /** Prints one canonical native session path from inside the guest. */
  discoverCommand: string;
}
export interface AgentLaunchSpec {
  executable: string;
  args: string[];
  env: Record<string, string>;
  stdin: "prompt";
  artifacts: ArtifactLocator;
  traceSources?: TraceSources;
}
export interface AgentDriver {
  readonly kind: AgentKind;
  launch(runId: string, config: AgentConfiguration): AgentLaunchSpec;
}

class CodexDriver implements AgentDriver {
  readonly kind = "codex" as const;
  launch(runId: string, config: AgentConfiguration): AgentLaunchSpec {
    const args = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--color", "never", "-c", "model_provider=exe-llm", "-c", 'model_providers.exe-llm.name="exe-llm"', "-c", 'model_providers.exe-llm.base_url="https://llm.int.exe.xyz/v1"'];
    if (config.model?.trim()) args.push("--model", config.model.trim());
    if (config.effort?.trim()) args.push("-c", `model_reasoning_effort=${config.effort.trim()}`);
    const nativeSession = { kind: "native_session" as const, path: "${CODEX_HOME:-$HOME/.codex}/sessions", mediaType: "application/x-ndjson" as const, provider: this.kind, discoverCommand: `find "\${CODEX_HOME:-$HOME/.codex}/sessions" -type f -name 'rollout-*.jsonl' -printf '%T@ %p\\n' | sort -nr | head -1 | cut -d' ' -f2-` };
    return {
      executable: "codex", args, env: {}, stdin: "prompt",
      artifacts: { roots: [nativeSession.path], fileNameIncludes: "rollout-", discoverCommand: nativeSession.discoverCommand },
      traceSources: {
        primary: { kind: "execution_stream", path: `/tmp/factorize-artifacts/${runId}/codex-exec.jsonl`, mediaType: "application/x-ndjson", provider: this.kind, formatVersion: "codex-exec-jsonl" },
        nativeSession,
      },
    };
  }
}

class ClaudeDriver implements AgentDriver {
  readonly kind = "claude" as const;
  launch(runId: string, config: AgentConfiguration): AgentLaunchSpec {
    const args = ["-p", "--dangerously-skip-permissions", "--session-id", runId];
    if (config.model?.trim()) args.push("--model", config.model.trim());
    if (config.effort?.trim()) args.push("--effort", config.effort.trim());
    return { executable: "claude", args, env: {}, stdin: "prompt", artifacts: { roots: ["$HOME/.claude/projects"], fileNameIncludes: runId, sessionId: runId, discoverCommand: `find "$HOME/.claude/projects" -type f -name '*${runId}.jsonl' -print | head -1` } };
  }
}

class PiDriver implements AgentDriver {
  readonly kind = "pi" as const;
  launch(runId: string, config: AgentConfiguration): AgentLaunchSpec {
    const sessionDir = `/tmp/factorize-artifacts/${runId}/pi`;
    const args = ["-p", "--session-id", runId, "--session-dir", sessionDir];
    if (config.model?.trim()) args.push("--model", config.model.trim());
    if (config.effort?.trim()) args.push("--thinking", config.effort.trim());
    return { executable: "pi", args, env: {}, stdin: "prompt", artifacts: { roots: [sessionDir], fileNameIncludes: ".jsonl", sessionId: runId, discoverCommand: `find '${sessionDir}' -type f -name '*.jsonl' -print | head -1` } };
  }
}

const drivers: Record<AgentKind, AgentDriver> = { codex: new CodexDriver(), claude: new ClaudeDriver(), pi: new PiDriver() };
export function agentDriver(kind: AgentKind): AgentDriver {
  const driver = drivers[kind];
  return { kind, launch(runId, config) { const spec = driver.launch(runId, config); return { ...spec, traceSources: driverTraceSources(kind, spec) }; } };
}

/** Compatibility for drivers and historical runs that only declare native sessions. */
export function driverTraceSources(kind: AgentKind, launch: AgentLaunchSpec): TraceSources {
  return launch.traceSources ?? { primary: { kind: "native_session", path: launch.artifacts.roots[0], mediaType: "application/x-ndjson", provider: kind, discoverCommand: launch.artifacts.discoverCommand } };
}
