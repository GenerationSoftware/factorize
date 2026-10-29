import type { AgentKind } from "./agent-driver";

export interface ExeConnection {
  apiToken: string;
  /** Legacy fields are read only during the migration window. Targets are authoritative. */
  tags?: string[];
  availableTags?: string[];
  agentKind?: AgentKind;
  models?: string[];
  modelsRefreshedAt?: string;
  modelsByAgent?: Partial<Record<AgentKind, string[]>>;
  modelsRefreshedAtByAgent?: Partial<Record<AgentKind, string>>;
}

/**
 * Labels that may be selected by a job. Older connections stored their
 * discovered/configured labels in `tags`; keep those labels usable while the
 * connection is migrated to the `availableTags` inventory.
 */
export function selectableExeTags(connection: { availableTags?: unknown; tags?: unknown }): string[] {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  return [...new Set([...strings(connection.availableTags), ...strings(connection.tags)])].sort((a, b) => a.localeCompare(b));
}

export const effortOptions: Record<AgentKind, string[]> = {
  codex: ["minimal", "low", "medium", "high", "xhigh"],
  claude: ["low", "medium", "high"],
  pi: [],
};

export interface ExeRunConnection extends ExeConnection {
  agentCommand?: string;
  model?: string;
  effort?: string;
  efforts?: string[];
  image?: string;
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
