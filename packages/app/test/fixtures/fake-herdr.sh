#!/usr/bin/env bash
set -euo pipefail

state_dir=${FAKE_HERDR_STATE_DIR:?FAKE_HERDR_STATE_DIR is required}
mkdir -p "$state_dir"
printf '%s %s\n' "${1:-}" "${2:-}" >> "$state_dir/events"

agent_json() {
  local status
  status=$(cat "$state_dir/status")
  printf '{"result":{"agent":{"name":"%s","agent":"codex","agent_status":"%s","interactive_ready":true,"cwd":"%s","workspace_id":"w-test","tab_id":"w-test:t1","pane_id":"w-test:p1","terminal_id":"term-test"}}}\n' \
    "$(cat "$state_dir/name")" "$status" "$FAKE_HERDR_RUN_PATH"
}

case "${1:-} ${2:-}" in
  "workspace list")
    printf '{"result":{"workspaces":[]}}\n'
    ;;
  "workspace create")
    printf '{"result":{"workspace":{"workspace_id":"w-test"},"tab":{"tab_id":"w-test:t1"},"root_pane":{"pane_id":"w-test:p1"}}}\n'
    ;;
  "tab rename")
    printf '{"result":{"tab":{"tab_id":"w-test:t1"}}}\n'
    ;;
  "agent get")
    test -f "$state_dir/status"
    agent_json
    ;;
  "agent start")
    name=${3:?agent name is required}
    printf '%s' "$name" > "$state_dir/name"
    printf '%s' "${@: -1}" > "$state_dir/launch-instruction"
    printf working > "$state_dir/status"
    agent_json
    ;;
  "agent read")
    if [ "${FAKE_HERDR_TRUST_PROMPT:-}" = 1 ] && [ ! -f "$state_dir/trusted" ]; then
      printf 'Do you trust the contents of this directory? 1. Yes, continue 2. No, quit\n'
    else
      printf 'Agent ready\n'
    fi
    ;;
  "agent wait")
    test "$(cat "$state_dir/status")" = idle
    agent_json
    ;;
  "agent prompt")
    if [ "${FAKE_HERDR_TRUST_PROMPT:-}" = 1 ] && [ ! -f "$state_dir/trusted" ]; then
      test "${4-}" = 1
      : > "$state_dir/trusted"
    else
      test "$(cat "$state_dir/status")" = idle
      printf '%s' "${4-}" > "$state_dir/prompt"
      printf working > "$state_dir/status"
    fi
    agent_json
    ;;
  *)
    printf 'unsupported fake Herdr command: %q ' "$@" >&2
    printf '\n' >&2
    exit 2
    ;;
esac
