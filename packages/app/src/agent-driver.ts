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
}
export interface AgentDriver {
  readonly kind: AgentKind;
  launch(runId: string, config: AgentConfiguration): AgentLaunchSpec;
}

class CodexDriver implements AgentDriver {
  readonly kind = "codex" as const;
  launch(_runId: string, config: AgentConfiguration): AgentLaunchSpec {
    const args = ["exec", "--dangerously-bypass-approvals-and-sandbox", "--color", "never", "-c", "model_provider=exe-llm", "-c", 'model_providers.exe-llm.name="exe-llm"', "-c", 'model_providers.exe-llm.base_url="https://llm.int.exe.xyz/v1"'];
    if (config.model?.trim()) args.push("--model", config.model.trim());
    if (config.effort?.trim()) args.push("-c", `model_reasoning_effort=${config.effort.trim()}`);
    return { executable: "codex", args, env: {}, stdin: "prompt", artifacts: { roots: ["${CODEX_HOME:-$HOME/.codex}/sessions"], fileNameIncludes: "rollout-", discoverCommand: `find "\${CODEX_HOME:-$HOME/.codex}/sessions" -type f -name 'rollout-*.jsonl' -printf '%T@ %p\\n' | sort -nr | head -1 | cut -d' ' -f2-` } };
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
export function agentDriver(kind: AgentKind): AgentDriver { return drivers[kind]; }
