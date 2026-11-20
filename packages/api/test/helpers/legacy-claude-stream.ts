/** Standalone guest harness. Python's stdlib avoids a dependency on a Node install in the VM. */
export const CLAUDE_STREAM_HARNESS = String.raw`
import json, os, signal, subprocess, sys

path = sys.argv[1]
tools = {}
record_number = 0
MAX_LINE = 16 * 1024 * 1024

def text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(text(x.get("text", x.get("thinking", ""))) if isinstance(x, dict) else text(x) for x in value)
    return json.dumps(value, ensure_ascii=False)

def emit(kind, title, preview, identity, parent=None, display=None):
    preview = text(preview)
    if len(preview) > 32768:
        preview = preview[:32768] + "\n… output truncated in trace view"
    display = display or {}
    if len(json.dumps(display, ensure_ascii=False).encode("utf-8")) > 1024 * 1024:
        display = dict(truncated=True, diagnostic="Display payload exceeded 1 MiB")
    item = dict(version=1, id=str(identity), type=kind, title=str(title)[:1024], preview=preview, display=display)
    if parent:
        item["parentId"] = str(parent)
    stream.write(json.dumps(item, ensure_ascii=False) + "\n")
    stream.flush()

def normalize(value):
    global record_number
    record_number += 1
    base = "claude:" + str(record_number)
    if not isinstance(value, dict):
        emit("warning", "Invalid Claude stream record", value, base)
        return
    base = str(value.get("uuid") or base)
    parent = value.get("parent_tool_use_id") or (value.get("tool_use_id") if value.get("type") == "system" else None)
    kind = value.get("type")
    if kind in ("assistant", "user"):
        message = value.get("message") or {}
        content = message.get("content", [])
        if isinstance(content, str):
            content = [dict(type="text", text=content)]
        if not isinstance(content, list):
            emit("warning", "Invalid Claude message", value, base, parent)
            return
        for i, block in enumerate(content):
            identity = base + ":" + str(i)
            if not isinstance(block, dict):
                emit("warning", "Unknown Claude content block", block, identity, parent)
                continue
            block_kind = block.get("type")
            if block_kind == "tool_use":
                tool_id = str(block.get("id") or identity)
                name = str(block.get("name") or "Tool call")
                tools[tool_id] = name
                emit("tool_call", name, block.get("input", {}), tool_id, parent, dict(arguments=block.get("input", {})))
            elif block_kind == "tool_result":
                tool_id = str(block.get("tool_use_id") or "")
                emit("tool_result", tools.get(tool_id, "Tool result"), block.get("content", ""), identity, tool_id or parent,
                     dict(toolUseId=tool_id, isError=bool(block.get("is_error")), toolName=tools.get(tool_id)))
            elif block_kind == "thinking":
                emit("reasoning", "Reasoning", block.get("thinking", ""), identity, parent)
            elif block_kind == "text":
                emit("assistant_message" if kind == "assistant" else "user_message", "Assistant" if kind == "assistant" else "User", block.get("text", ""), identity, parent)
            else:
                emit("warning", "Unknown Claude content block", block, identity, parent)
        if message.get("usage"):
            emit("usage", "Usage", message["usage"], base + ":usage", parent, dict(usage=message["usage"]))
        if value.get("error"):
            emit("error", "Claude assistant error", value["error"], base + ":error", parent)
    elif kind == "result":
        failed = value.get("is_error") or value.get("subtype") != "success"
        # result.result repeats the final assistant answer. Keep only the completion receipt.
        details = {k: v for k, v in value.items() if k not in ("result", "type", "uuid")}
        emit("error" if failed else "metadata", "Claude " + str(value.get("subtype", "result")), details, base, parent, details)
        if value.get("usage"):
            emit("usage", "Total usage", value["usage"], base + ":usage", parent, dict(usage=value["usage"], modelUsage=value.get("modelUsage", {})))
    elif kind in ("system", "error", "abort", "interrupt"):
        subtype = str(value.get("subtype", kind))
        event_kind = "error" if kind in ("error", "abort", "interrupt") or any(x in subtype for x in ("error", "abort", "interrupt")) else "metadata"
        emit(event_kind, "Claude " + subtype, value, base, parent, value)
    else:
        emit("warning", "Unknown Claude stream event", value, base, parent)

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "a", encoding="utf-8") as stream:
    try:
        child = subprocess.Popen(sys.argv[2:], stdin=sys.stdin, stdout=subprocess.PIPE, stderr=sys.stderr)
    except OSError as error:
        emit("error", "Claude launch failed", str(error), "claude:launch-error")
        sys.exit(127)
    def stop(signum, frame):
        emit("error", "Claude interrupted", dict(signal=signum), "claude:signal:" + str(signum))
        child.send_signal(signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while True:
        line = child.stdout.readline(MAX_LINE + 1)
        if not line:
            break
        if len(line) > MAX_LINE:
            while line and not line.endswith(b"\n"):
                line = child.stdout.readline(MAX_LINE + 1)
            record_number += 1
            emit("warning", "Oversized Claude stream record", "Record exceeded 16 MiB", "claude:" + str(record_number))
            continue
        if not line.strip():
            continue
        try:
            if not line.endswith(b"\n"):
                raise ValueError("Unterminated JSONL record at EOF")
            normalize(json.loads(line))
        except (ValueError, TypeError, AttributeError, RecursionError) as error:
            record_number += 1
            emit("warning", "Unparseable Claude stream record", str(error) + ": " + line[:32768].decode("utf-8", errors="replace"), "claude:" + str(record_number))
    code = child.wait()
    if code:
        emit("error", "Claude process exited", dict(exitCode=code), "claude:exit")
    sys.exit(code if code >= 0 else 128 - code)
`;
