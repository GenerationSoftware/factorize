export interface ExeConnection {
  apiToken: string;
  agentKind: string;
  tags: string[];
  repositoryUrl: string;
  checkoutRef?: string;
  agentCommand?: string;
  model?: string;
  effort?: string;
  models?: string[];
  modelsRefreshedAt?: string;
  efforts?: string[];
}

/** Single shell atom; prevents user-controlled values from becoming syntax. */
export function shellAtom(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function defaultAgentCommand(agentKind: string): string {
  if (agentKind === "codex") return "codex exec --dangerously-bypass-approvals-and-sandbox";
  if (agentKind === "claude") return "claude -p --dangerously-skip-permissions";
  return agentKind;
}
