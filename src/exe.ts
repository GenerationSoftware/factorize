import { base64 } from "./crypto";

export interface ExeConnection {
  vmName: string;
  apiToken: string;
  agentKind: string;
  cwd: string;
  herdrCommand?: string;
  agentCommand?: string;
}

export interface ExeResponse {
  ok: boolean;
  status: number;
  exitCode: number | null;
  body: string;
  requestBody: string;
}

/** Calls exe.dev's documented HTTPS SSH-command API. */
export async function exec(connection: ExeConnection, remoteCommand: string): Promise<ExeResponse> {
  const requestBody = `ssh ${shellAtom(connection.vmName)} ${shellAtom(remoteCommand)}`;
  const response = await fetch("https://exe.dev/exec", {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiToken}`, "Content-Type": "text/plain" },
    body: requestBody,
  });
  const body = await response.text();
  const exit = response.headers.get("X-Exe-Exit");
  return { ok: response.ok, status: response.status, exitCode: exit && /^\d+$/.test(exit) ? Number(exit) : null, body, requestBody };
}

/** Single shell atom; prevents ticket content from becoming syntax in either SSH parser. */
export function shellAtom(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function startAgentCommand(agentName: string, connection: ExeConnection, prompt: string, workspaceName = agentName): string {
  const encodedPrompt = base64(prompt);
  const name = agentName;
  const resetPrompt = newContextPrompt(connection.agentKind);
  // Herdr commands are deliberately kept to a fixed allowlist. The sole dynamic payload is base64.
  return [
    herdrPrefix(connection),
    `cd ${shellAtom(connection.cwd)}`,
    // A named agent stays live after completing a turn. Reuse an idle/done
    // slot instead of trying to start another agent with the same name.
    `existing=$(${herdrBinary(connection)} agent get ${shellAtom(name)} 2>/dev/null || true)`,
    "existing_status=$(printf '%s' \"$existing\" | jq -r '.result.agent.agent_status // .result.agent.state // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]')",
    `if [ -n \"$existing_status\" ]; then case \"$existing_status\" in idle|done) ${herdrBinary(connection)} agent prompt ${shellAtom(name)} ${shellAtom(resetPrompt)} ;; *) echo \"Factorize cannot reuse active Herdr agent ${name} (status: $existing_status)\" >&2; exit 1 ;; esac; else workspace=$(${herdrBinary(connection)} workspace create --cwd ${shellAtom(connection.cwd)} --label ${shellAtom(workspaceName)} --no-focus) && pane=$(printf '%s' \"$workspace\" | jq -r '.result.root_pane.pane_id // .pane_id // .paneId') && ${herdrBinary(connection)} agent start ${shellAtom(name)} --kind ${shellAtom(connection.agentKind)} --pane \"$pane\"${agentCommand(connection)}; fi`,
    `prompt=$(printf '%s' ${shellAtom(encodedPrompt)} | base64 -d)`,
    `${herdrBinary(connection)} agent prompt ${shellAtom(name)} \"$prompt\"`,
  ].join(" && ");
}

export function agentStatusCommand(connection: ExeConnection, agentName: string): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent get ${shellAtom(agentName)}`;
}

/** Current Herdr responses use `agent_status`; older releases used `state`. */
export function herdrAgentStatus(body: string): string | null {
  const match = body.match(/"(?:agent_status|state)"\s*:\s*"([^"\\]+)"/i);
  return match?.[1].toLowerCase() ?? null;
}

export function agentOutputCommand(connection: ExeConnection, agentName: string): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent read ${shellAtom(agentName)} --source recent --format text`;
}

export function herdrCheckCommand(connection: ExeConnection): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} --version && ${herdrBinary(connection)} workspace list`;
}

/** A deliberately minimal SSH round trip for validating an exe.dev token. */
export function connectionCheckCommand(): string {
  return "printf '%s\\n' factorize-connection-ok";
}

/** exe.dev executes non-interactive shells, which do not load the user's PATH customizations. */
function herdrPrefix(connection: ExeConnection): string {
  return `export PATH="$HOME/.local/bin:$PATH" && command -v ${shellAtom(herdrBinary(connection))}`;
}

function herdrBinary(connection: ExeConnection): string {
  return connection.herdrCommand?.trim() || "herdr";
}

function newContextPrompt(agentKind: string): string {
  return agentKind === "claude" ? "/clear" : "/new";
}

/** Herdr owns the executable; it forwards these arguments after `--` to it. */
function agentCommand(connection: ExeConnection): string {
  const command = connection.agentCommand?.trim() || defaultAgentCommand(connection.agentKind);
  return command ? ` -- ${shellWords(command).map(shellAtom).join(" ")}` : "";
}

export function defaultAgentCommand(agentKind: string): string {
  if (agentKind === "codex") return "--dangerously-bypass-approvals-and-sandbox";
  if (agentKind === "claude") return "--dangerously-skip-permissions";
  return "";
}

/** Parse a small, predictable shell-style argument list without ever executing it. */
function shellWords(value: string): string[] {
  const words: string[] = [];
  const pattern = /(?:[^\s'\"]+|'[^']*'|\"[^\"]*\")+/g;
  for (const match of value.matchAll(pattern)) words.push(match[0].replace(/^'|'$/g, "").replace(/^\"|\"$/g, ""));
  return words;
}
