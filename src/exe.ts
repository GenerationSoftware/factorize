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

export function startAgentCommand(agentName: string, connection: ExeConnection, prompt: string, workspaceName: string, worktreePath: string, lease: string): string {
  const encodedPrompt = base64(prompt);
  const name = agentName;
  const herdr = herdrBinary(connection);
  // Herdr commands are deliberately kept to a fixed allowlist. The sole dynamic payload is base64.
  return [
    herdrPrefix(connection),
    `cd ${shellAtom(connection.cwd)}`,
    `mkdir -p ${shellAtom(`${connection.cwd.replace(/\/$/, "")}/.factorize-worktrees`)}`,
    `test ! -e ${shellAtom(worktreePath)} && git worktree add --detach ${shellAtom(worktreePath)} HEAD`,
    `gitdir=$(git -C ${shellAtom(worktreePath)} rev-parse --git-dir)`,
    `printf '%s' ${shellAtom(lease)} > "$gitdir/factorize-lease"`,
    `workspaces=$(${herdr} workspace list)`,
    `workspace_id=$(printf '%s' "$workspaces" | jq -r --arg label ${shellAtom(workspaceName)} '.result.workspaces[]? | select(.label == $label) | .workspace_id' | head -n1)`,
    `if [ -z "$workspace_id" ]; then workspace=$(${herdr} workspace create --cwd ${shellAtom(connection.cwd)} --label ${shellAtom(workspaceName)} --no-focus) && workspace_id=$(printf '%s' "$workspace" | jq -er '.result.workspace.workspace_id') && anchor=$(printf '%s' "$workspace" | jq -er '.result.root_pane.pane_id'); else anchor=$(${herdr} pane list --workspace "$workspace_id" | jq -er '.result.panes[0].pane_id'); fi`,
    `created=$(${herdr} pane split "$anchor" --direction down --cwd ${shellAtom(worktreePath)} --no-focus)`,
    `pane=$(printf '%s' "$created" | jq -er '.result.pane.pane_id')`,
    `${herdr} agent start ${shellAtom(name)} --kind ${shellAtom(connection.agentKind)} --pane "$pane"${agentCommand(connection)}`,
    `prompt=$(printf '%s' ${shellAtom(encodedPrompt)} | base64 -d)`,
    `${herdrBinary(connection)} agent prompt ${shellAtom(name)} \"$prompt\"`,
    `${herdrBinary(connection)} agent get ${shellAtom(name)}`,
  ].join(" && ");
}

export function agentListCommand(connection: ExeConnection): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent list`; }
export function paneGetCommand(connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} pane get ${shellAtom(paneId)}`; }
export function paneProcessInfoCommand(connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} pane process-info ${shellAtom(paneId)}`; }
export function validateWorktreeLeaseCommand(connection: ExeConnection, worktreePath: string, lease: string): string { return `${herdrPrefix(connection)} && test "$(git -C ${shellAtom(worktreePath)} rev-parse --show-toplevel)" = ${shellAtom(worktreePath)} && gitdir=$(git -C ${shellAtom(worktreePath)} rev-parse --git-dir) && test "$(cat "$gitdir/factorize-lease")" = ${shellAtom(lease)}`; }
export function renameAgentCommand(connection: ExeConnection, currentName: string, expectedName: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent rename ${shellAtom(currentName)} ${shellAtom(expectedName)} && ${herdrBinary(connection)} agent get ${shellAtom(expectedName)}`; }
export function startAgentInPaneCommand(agentName: string, connection: ExeConnection, paneId: string, cwd = connection.cwd): string { return `${herdrPrefix(connection)} && cd ${shellAtom(cwd)} && ${herdrBinary(connection)} agent start ${shellAtom(agentName)} --kind ${shellAtom(connection.agentKind)} --pane ${shellAtom(paneId)}${agentCommand(connection)} && ${herdrBinary(connection)} agent get ${shellAtom(agentName)}`; }

/** Stop only the foreground process group observed in the exact persisted pane.
 * Every signal is preceded by a fresh identity read, preventing stale-PID races. */
export function replaceForegroundCommand(agentName: string, connection: ExeConnection, paneId: string, cwd = connection.cwd): string {
  const herdr = herdrBinary(connection), pane = shellAtom(paneId);
  const fields = `jq -er --arg pane ${pane} --arg cwd ${shellAtom(cwd)} '[.result.pane_id // .pane_id // .result.pane.pane_id, .result.foreground.pid // .result.pid // .pid, .result.foreground.process_group // .result.foreground.pgid // .result.process_group // .result.pgid // .pgid, .result.foreground.cwd // .result.cwd // .cwd] | select(.[0] == $pane and .[1] > 1 and .[2] > 1 and .[3] == $cwd) | @tsv'`;
  return [herdrPrefix(connection), `first=$(${herdr} pane process-info ${pane} | ${fields})`, `first_pid=$(printf '%s' "$first" | cut -f2)`, `first_pgid=$(printf '%s' "$first" | cut -f3)`, `kill -INT -- "-$first_pgid"`, `i=0; while [ "$i" -lt 10 ] && kill -0 -- "-$first_pgid" 2>/dev/null; do i=$((i+1)); sleep 1; done`, `if kill -0 -- "-$first_pgid" 2>/dev/null; then second=$(${herdr} pane process-info ${pane} | ${fields}) && second_pid=$(printf '%s' "$second" | cut -f2) && second_pgid=$(printf '%s' "$second" | cut -f3) && [ "$second_pid" = "$first_pid" ] && [ "$second_pgid" = "$first_pgid" ] && kill -TERM -- "-$first_pgid"; fi`, `i=0; while [ "$i" -lt 10 ] && kill -0 -- "-$first_pgid" 2>/dev/null; do i=$((i+1)); sleep 1; done`, `! kill -0 -- "-$first_pgid" 2>/dev/null`, `cd ${shellAtom(cwd)}`, `${herdr} agent start ${shellAtom(agentName)} --kind ${shellAtom(connection.agentKind)} --pane ${pane}${agentCommand(connection)}`, `${herdr} agent get ${shellAtom(agentName)}`].join(" && ");
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

export function stopAgentCommand(connection: ExeConnection, agentName: string): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent stop ${shellAtom(agentName)}`;
}

/** Revalidate terminal, worktree, and lease immediately before closing a pane. */
export function garbageCollectPaneCommand(connection: ExeConnection, paneId: string, terminalId: string, worktreePath: string, lease: string): string {
  const herdr = herdrBinary(connection), pane = shellAtom(paneId);
  return [herdrPrefix(connection), `pane_json=$(${herdr} pane get ${pane})`, `printf '%s' "$pane_json" | jq -e --arg pane ${pane} --arg terminal ${shellAtom(terminalId)} '(.result.pane // .result) | .pane_id == $pane and .terminal_id == $terminal' >/dev/null`, `test "$(git -C ${shellAtom(worktreePath)} rev-parse --show-toplevel)" = ${shellAtom(worktreePath)}`, `gitdir=$(git -C ${shellAtom(worktreePath)} rev-parse --git-dir)`, `test "$(cat "$gitdir/factorize-lease")" = ${shellAtom(lease)}`, `agent=$(${herdr} agent get ${pane} 2>/dev/null || true)`, `status=$(printf '%s' "$agent" | jq -r '.result.agent.agent_status // .result.agent.state // empty' | tr '[:upper:]' '[:lower:]')`, `case "$status" in ''|idle|done) ;; *) exit 1 ;; esac`, `[ -z "$status" ] || ${herdr} agent stop ${pane}`, `test -z "$(${herdr} agent get ${pane} 2>/dev/null || true)"`, `process=$(${herdr} pane process-info ${pane})`, `printf '%s' "$process" | jq -e '(.result.foreground.executable // .result.process.executable // "") | test("(^|/)(ba|z|fi)?sh$")' >/dev/null`, `${herdr} pane close ${pane}`].join(" && ");
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
