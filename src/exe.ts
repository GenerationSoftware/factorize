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
    `${herdrBinary(connection)} agent get ${shellAtom(name)}`,
  ].join(" && ");
}

export function agentListCommand(connection: ExeConnection): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent list`; }
export function paneGetCommand(connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} pane get ${shellAtom(paneId)}`; }
export function paneProcessInfoCommand(connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} pane process-info ${shellAtom(paneId)}`; }
export function renameAgentCommand(connection: ExeConnection, currentName: string, expectedName: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent rename ${shellAtom(currentName)} ${shellAtom(expectedName)} && ${herdrBinary(connection)} agent get ${shellAtom(expectedName)}`; }
export function startAgentInPaneCommand(agentName: string, connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && cd ${shellAtom(connection.cwd)} && ${herdrBinary(connection)} agent start ${shellAtom(agentName)} --kind ${shellAtom(connection.agentKind)} --pane ${shellAtom(paneId)}${agentCommand(connection)} && ${herdrBinary(connection)} agent get ${shellAtom(agentName)}`; }

/** Stop only the foreground process group observed in the exact persisted pane.
 * Every signal is preceded by a fresh identity read, preventing stale-PID races. */
export function replaceForegroundCommand(agentName: string, connection: ExeConnection, paneId: string): string {
  const herdr = herdrBinary(connection), pane = shellAtom(paneId);
  const fields = `jq -er --arg pane ${pane} --arg cwd ${shellAtom(connection.cwd)} '[.result.pane_id // .pane_id // .result.pane.pane_id, .result.foreground.pid // .result.pid // .pid, .result.foreground.process_group // .result.foreground.pgid // .result.process_group // .result.pgid // .pgid, .result.foreground.cwd // .result.cwd // .cwd] | select(.[0] == $pane and .[1] > 1 and .[2] > 1 and .[3] == $cwd) | @tsv'`;
  return [herdrPrefix(connection), `first=$(${herdr} pane process-info ${pane} | ${fields})`, `first_pid=$(printf '%s' "$first" | cut -f2)`, `first_pgid=$(printf '%s' "$first" | cut -f3)`, `kill -INT -- "-$first_pgid"`, `i=0; while [ "$i" -lt 10 ] && kill -0 -- "-$first_pgid" 2>/dev/null; do i=$((i+1)); sleep 1; done`, `if kill -0 -- "-$first_pgid" 2>/dev/null; then second=$(${herdr} pane process-info ${pane} | ${fields}) && second_pid=$(printf '%s' "$second" | cut -f2) && second_pgid=$(printf '%s' "$second" | cut -f3) && [ "$second_pid" = "$first_pid" ] && [ "$second_pgid" = "$first_pgid" ] && kill -TERM -- "-$first_pgid"; fi`, `i=0; while [ "$i" -lt 10 ] && kill -0 -- "-$first_pgid" 2>/dev/null; do i=$((i+1)); sleep 1; done`, `! kill -0 -- "-$first_pgid" 2>/dev/null`, `cd ${shellAtom(connection.cwd)}`, `${herdr} agent start ${shellAtom(agentName)} --kind ${shellAtom(connection.agentKind)} --pane ${pane}${agentCommand(connection)}`, `${herdr} agent get ${shellAtom(agentName)}`].join(" && ");
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
