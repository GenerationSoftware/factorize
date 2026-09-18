import type { AgentKind } from "./agent-driver";

export interface ExeConnection {
  apiToken: string;
  tags: string[];
  agentKind: AgentKind;
  models?: string[];
  modelsRefreshedAt?: string;
}

export interface ExeRunConnection extends ExeConnection {
  agentCommand?: string;
  model?: string;
  effort?: string;
  efforts?: string[];
}

/** Single shell atom; prevents user-controlled values from becoming syntax. */
export function shellAtom(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function defaultAgentCommand(agentKind: string): string {
  if (agentKind === "codex") return "codex exec --dangerously-bypass-approvals-and-sandbox";
  if (agentKind === "claude") return "claude -p --dangerously-skip-permissions";
  if (agentKind === "pi") return "pi -p";
  return agentKind;
}
