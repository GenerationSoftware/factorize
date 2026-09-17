import { base64 } from "./crypto";

export interface ExeConnection {
  vmName: string;
  apiToken: string;
  agentKind: string;
  cwd: string;
  herdrCommand?: string;
  agentCommand?: string;
  /** Per-job harness model. Empty means the harness chooses its default. */
  model?: string;
  /** Per-job reasoning effort. Empty means the harness chooses its default. */
  effort?: string;
  /** Models returned by the VM's attached exe.dev LLM integration. */
  models?: string[];
  modelsRefreshedAt?: string;
  efforts?: string[];
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
  const marker = `__factorize_exit_${crypto.randomUUID().replaceAll("-", "")}__`;
  const wrappedCommand = `( ${remoteCommand} ); factorize_exit=$?; printf '\\n${marker}:%s\\n' "$factorize_exit"; exit "$factorize_exit"`;
  const requestBody = `ssh ${shellAtom(connection.vmName)} ${shellAtom(wrappedCommand)}`;
  const response = await fetch("https://exe.dev/exec", {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiToken}`, "Content-Type": "text/plain" },
    body: requestBody,
  });
  const rawBody = await response.text();
  const sentinel = new RegExp(`(?:\\r?\\n)?${marker}:(\\d+)(?:\\r?\\n)?$`);
  const captured = rawBody.match(sentinel);
  const headerExit = response.headers.get("X-Exe-Exit");
  const exitCode = captured ? Number(captured[1]) : headerExit && /^\d+$/.test(headerExit) ? Number(headerExit) : null;
  const body = captured ? rawBody.replace(sentinel, "") : rawBody;
  return { ok: response.ok && exitCode === 0, status: response.status, exitCode, body, requestBody };
}

/** Single shell atom; prevents ticket content from becoming syntax in either SSH parser. */
export function shellAtom(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function launchAgentCommand(agentName: string, connection: ExeConnection, workspaceName: string, runPath: string, lease: string, prompt: string): string {
  const name = agentName;
  const herdr = herdrBinary(connection);
  const promptDirectory = `/tmp/factorize-prompts/${agentName}`;
  const promptPath = `${promptDirectory}/prompt.md`;
  const launchInstruction = `Read and follow the complete task instructions in ${promptPath}`;
  return [
    herdrPrefix(connection),
    `cd ${shellAtom(connection.cwd)}`,
    `mkdir -p ${shellAtom(`${connection.cwd.replace(/\/$/, "")}/.factorize-runs`)}`,
    `if [ ! -e ${shellAtom(runPath)} ]; then mkdir ${shellAtom(runPath)}; fi`,
    `test -d ${shellAtom(runPath)}`,
    `if [ -e ${shellAtom(`${runPath}/.factorize-lease`)} ]; then test "$(cat ${shellAtom(`${runPath}/.factorize-lease`)})" = ${shellAtom(lease)}; else printf '%s' ${shellAtom(lease)} > ${shellAtom(`${runPath}/.factorize-lease`)}; fi`,
    `mkdir -p ${shellAtom(promptDirectory)}`,
    `chmod 700 ${shellAtom(promptDirectory)}`,
    `printf '%s' ${shellAtom(base64(prompt))} | base64 -d > ${shellAtom(promptPath)}`,
    `chmod 600 ${shellAtom(promptPath)}`,
    `workspaces=$(${herdr} workspace list)`,
    `workspace_id=$(printf '%s' "$workspaces" | jq -r --arg label ${shellAtom(workspaceName)} '.result.workspaces[]? | select(.label == $label) | .workspace_id' | head -n1)`,
    `if [ -z "$workspace_id" ]; then created=$(${herdr} workspace create --cwd ${shellAtom(runPath)} --label ${shellAtom(workspaceName)} --no-focus) && workspace_id=$(printf '%s' "$created" | jq -er '.result.workspace.workspace_id') && tab_id=$(printf '%s' "$created" | jq -er '.result.tab.tab_id') && pane=$(printf '%s' "$created" | jq -er '.result.root_pane.pane_id') && ${herdr} tab rename "$tab_id" ${shellAtom(name)} >/dev/null; else tabs=$(${herdr} tab list --workspace "$workspace_id") && tab_id=$(printf '%s' "$tabs" | jq -r --arg label ${shellAtom(name)} '.result.tabs[]? | select(.label == $label) | .tab_id' | head -n1); if [ -z "$tab_id" ]; then created=$(${herdr} tab create --workspace "$workspace_id" --cwd ${shellAtom(runPath)} --label ${shellAtom(name)} --no-focus) && tab_id=$(printf '%s' "$created" | jq -er '.result.tab.tab_id') && pane=$(printf '%s' "$created" | jq -er '.result.root_pane.pane_id'); else panes=$(${herdr} pane list --workspace "$workspace_id") && pane=$(printf '%s' "$panes" | jq -r --arg tab "$tab_id" '.result.panes[]? | select(.tab_id == $tab) | .pane_id' | head -n1); test -n "$pane"; extras=$(printf '%s' "$panes" | jq -r --arg tab "$tab_id" --arg keep "$pane" '.result.panes[]? | select(.tab_id == $tab and .pane_id != $keep) | .pane_id'); for extra in $extras; do ${herdr} pane close "$extra" >/dev/null; done; fi; fi`,
    `existing=$(${herdr} agent get ${shellAtom(name)} 2>/dev/null || true)`,
    `if [ -n "$existing" ]; then printf '%s\\n' "$existing"; else ${terminalEnvironment()}${startupTrustLock(connection)}${herdr} agent start ${shellAtom(name)} --kind ${shellAtom(connection.agentKind)} --pane "$pane"${agentCommand(connection, launchInstruction, runPath)}${startupTrustCommand(connection, name)}${startupTrustUnlock(connection)} && ${herdr} agent get ${shellAtom(name)}; fi`,
  ].join(" && ");
}

/** Codex evaluates directory trust before applying CLI project config overrides.
 * Herdr reports the chooser as interactive-ready, so automation must answer it in the pane. */
function startupTrustCommand(connection: ExeConnection, agentName: string): string {
  if (connection.agentKind !== "codex") return "";
  const herdr = herdrBinary(connection), name = shellAtom(agentName);
  return ` && startup_output=$(${herdr} agent read ${name} --source recent --format text) && case "$startup_output" in *"Do you trust the contents of this directory?"*) ${herdr} agent prompt ${name} '1' --wait --until working --until idle --timeout 15000 >/dev/null ;; esac`;
}

/** Every trust acceptance rewrites the shared Codex config. Serialize that brief handshake so
 * simultaneous Factorize runs cannot make config/batchWrite race on config.toml. */
function startupTrustLock(connection: ExeConnection): string {
  if (connection.agentKind !== "codex") return "";
  return `trust_lock=/tmp/factorize-codex-trust-$(id -u).lock && exec 9>"$trust_lock" && flock 9 && `;
}

function startupTrustUnlock(connection: ExeConnection): string {
  return connection.agentKind === "codex" ? ` && flock -u 9` : "";
}

export function promptAgentCommand(connection: ExeConnection, agentName: string, prompt: string): string {
  const encodedPrompt = base64(prompt), herdr = herdrBinary(connection);
  const name = shellAtom(agentName);
  return [
    herdrPrefix(connection),
    `${herdr} agent wait ${name} --until idle --until done --timeout 15000 >/dev/null`,
    `prompt=$(printf '%s' ${shellAtom(encodedPrompt)} | base64 -d)`,
    `${herdr} agent prompt ${name} "$prompt" --wait --until working --until blocked --timeout 7000`,
  ].join(" && ");
}

/** Compatibility helper used by recovery paths; prompt delivery is never skipped. */
export function startAgentCommand(agentName: string, connection: ExeConnection, prompt: string, workspaceName: string, runPath: string, lease: string): string {
  return launchAgentCommand(agentName, connection, workspaceName, runPath, lease, prompt);
}

export function agentListCommand(connection: ExeConnection): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent list`; }
export function paneGetCommand(connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} pane get ${shellAtom(paneId)}`; }
export function paneProcessInfoCommand(connection: ExeConnection, paneId: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} pane process-info --pane ${shellAtom(paneId)}`; }
export function validateWorktreeLeaseCommand(connection: ExeConnection, runPath: string, lease: string): string { return `${herdrPrefix(connection)} && test -d ${shellAtom(runPath)} && test "$(cat ${shellAtom(`${runPath}/.factorize-lease`)})" = ${shellAtom(lease)}`; }
export function renameAgentCommand(connection: ExeConnection, currentName: string, expectedName: string): string { return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent rename ${shellAtom(currentName)} ${shellAtom(expectedName)} && ${herdrBinary(connection)} agent get ${shellAtom(expectedName)}`; }
export function startAgentInPaneCommand(agentName: string, connection: ExeConnection, paneId: string, cwd = connection.cwd): string { return `${herdrPrefix(connection)} && cd ${shellAtom(cwd)} && ${terminalEnvironment()}${herdrBinary(connection)} agent start ${shellAtom(agentName)} --kind ${shellAtom(connection.agentKind)} --pane ${shellAtom(paneId)}${agentCommand(connection, undefined, cwd)} && ${herdrBinary(connection)} agent get ${shellAtom(agentName)}`; }

/** Stop only the foreground process group observed in the exact persisted pane.
 * Every signal is preceded by a fresh identity read, preventing stale-PID races. */
export function replaceForegroundCommand(agentName: string, connection: ExeConnection, paneId: string, cwd = connection.cwd): string {
  const herdr = herdrBinary(connection), pane = shellAtom(paneId);
  const fields = `jq -er --arg pane ${pane} --arg cwd ${shellAtom(cwd)} '[.result.pane_id // .pane_id // .result.pane.pane_id, .result.foreground.pid // .result.pid // .pid, .result.foreground.process_group // .result.foreground.pgid // .result.process_group // .result.pgid // .pgid, .result.foreground.cwd // .result.cwd // .cwd] | select(.[0] == $pane and .[1] > 1 and .[2] > 1 and .[3] == $cwd) | @tsv'`;
  return [herdrPrefix(connection), `first=$(${herdr} pane process-info --pane ${pane} | ${fields})`, `first_pid=$(printf '%s' "$first" | cut -f2)`, `first_pgid=$(printf '%s' "$first" | cut -f3)`, `kill -INT -- "-$first_pgid"`, `i=0; while [ "$i" -lt 10 ] && kill -0 -- "-$first_pgid" 2>/dev/null; do i=$((i+1)); sleep 1; done`, `if kill -0 -- "-$first_pgid" 2>/dev/null; then second=$(${herdr} pane process-info --pane ${pane} | ${fields}) && second_pid=$(printf '%s' "$second" | cut -f2) && second_pgid=$(printf '%s' "$second" | cut -f3) && [ "$second_pid" = "$first_pid" ] && [ "$second_pgid" = "$first_pgid" ] && kill -TERM -- "-$first_pgid"; fi`, `i=0; while [ "$i" -lt 10 ] && kill -0 -- "-$first_pgid" 2>/dev/null; do i=$((i+1)); sleep 1; done`, `! kill -0 -- "-$first_pgid" 2>/dev/null`, `cd ${shellAtom(cwd)}`, `${terminalEnvironment()}${herdr} agent start ${shellAtom(agentName)} --kind ${shellAtom(connection.agentKind)} --pane ${pane}${agentCommand(connection, undefined, cwd)}`, `${herdr} agent get ${shellAtom(agentName)}`].join(" && ");
}

export function agentStatusCommand(connection: ExeConnection, agentName: string): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent get ${shellAtom(agentName)}`;
}

/** Current Herdr responses use `agent_status`; older releases used `state`. */
export function herdrAgentStatus(body: string): string | null {
  const match = body.match(/"(?:agent_status|state)"\s*:\s*"([^"\\]+)"/i);
  return match?.[1].toLowerCase() ?? null;
}

/** Codex can be alive in the pane while still waiting for an interactive startup decision. */
export function agentStartupBlocked(body: string): boolean {
  const normalized = body.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, " ").replace(/\s+/g, " ").toLowerCase();
  return normalized.includes("do you trust the contents of this directory?")
    || normalized.includes("press enter to continue") && normalized.includes("yes, continue") && normalized.includes("no, quit");
}

export function agentOutputCommand(connection: ExeConnection, agentName: string): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} agent read ${shellAtom(agentName)} --source recent --format text`;
}

export function stopAgentCommand(connection: ExeConnection, agentName: string): string {
  const herdr = herdrBinary(connection);
  return `${herdrPrefix(connection)} && agent=$(${herdr} agent get ${shellAtom(agentName)}) && pane=$(printf '%s' "$agent" | jq -er '.result.agent.pane_id') && ${herdr} pane close "$pane"`;
}

/** Revalidate terminal, run directory, and lease immediately before closing a pane. */
export function garbageCollectPaneCommand(connection: ExeConnection, paneId: string, terminalId: string, runPath: string, lease: string): string {
  const herdr = herdrBinary(connection), pane = shellAtom(paneId);
  const runsDirectory = `${connection.cwd.replace(/\/$/, "")}/.factorize-runs`;
  return [herdrPrefix(connection), `test ${shellAtom(runPath)} != ${shellAtom(runsDirectory)}`, `case ${shellAtom(runPath)} in ${shellAtom(`${runsDirectory}/`)}*) ;; *) exit 1 ;; esac`, `pane_json=$(${herdr} pane get ${pane})`, `printf '%s' "$pane_json" | jq -e --arg pane ${pane} --arg terminal ${shellAtom(terminalId)} '(.result.pane // .result) | .pane_id == $pane and .terminal_id == $terminal' >/dev/null`, `test -d ${shellAtom(runPath)}`, `test "$(cat ${shellAtom(`${runPath}/.factorize-lease`)})" = ${shellAtom(lease)}`, `agent=$(${herdr} agent get ${pane} 2>/dev/null || true)`, `status=$(printf '%s' "$agent" | jq -r '.result.agent.agent_status // .result.agent.state // empty' | tr '[:upper:]' '[:lower:]')`, `case "$status" in ''|idle|done) ;; *) exit 1 ;; esac`, `${herdr} pane close ${pane}`, `rm -rf -- ${shellAtom(runPath)}`, `test ! -e ${shellAtom(runPath)}`].join(" && ");
}

export function herdrCheckCommand(connection: ExeConnection): string {
  return `${herdrPrefix(connection)} && ${herdrBinary(connection)} --version && ${herdrBinary(connection)} workspace list`;
}

/** A deliberately minimal SSH round trip for validating an exe.dev token. */
export function connectionCheckCommand(): string {
  return "printf '%s\\n' factorize-connection-ok";
}

/** Query the documented exe.dev LLM integration from inside the connected VM. */
export function modelListCommand(): string {
  return "curl --fail --silent --show-error https://llm.int.exe.xyz/v1/models | jq -cer '[.data[]?.id | strings] | unique'";
}

export function parseModelList(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(model => typeof model !== "string")) throw new Error("The model endpoint returned an invalid response");
  return [...new Set(parsed.map(model => model.trim()).filter(Boolean))].sort();
}

/** exe.dev executes non-interactive shells, which do not load the user's PATH customizations. */
function herdrPrefix(connection: ExeConnection): string {
  return `export PATH="$HOME/.local/bin:$PATH" && command -v ${shellAtom(herdrBinary(connection))} >/dev/null`;
}

function herdrBinary(connection: ExeConnection): string {
  return connection.herdrCommand?.trim() || "herdr";
}

/** Make terminal-aware tools emit their original ANSI/SGR styling in captured output. */
function terminalEnvironment(): string {
  return "export TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=1 CLICOLOR_FORCE=1 && ";
}

/** Herdr owns the executable; it forwards these arguments after `--` to it. */
function agentCommand(connection: ExeConnection, prompt?: string, cwd?: string): string {
  const command = connection.agentCommand?.trim() || defaultAgentCommand(connection.agentKind);
  const args = command ? shellWords(command).map(shellAtom) : [];
  if (connection.model?.trim()) args.push(shellAtom("--model"), shellAtom(connection.model.trim()));
  if (connection.effort?.trim() && connection.agentKind === "codex") args.push(shellAtom("-c"), shellAtom(`model_reasoning_effort=${connection.effort.trim()}`));
  if (connection.agentKind === "codex" && cwd) args.push("--dangerously-bypass-hook-trust", "--cd", shellAtom(cwd), "-c", shellAtom(`projects.${JSON.stringify(cwd)}.trust_level="trusted"`));
  if (prompt !== undefined) args.push("--", shellAtom(prompt));
  return args.length ? ` -- ${args.join(" ")}` : "";
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
