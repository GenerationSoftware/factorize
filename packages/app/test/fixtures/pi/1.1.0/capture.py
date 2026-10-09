"""Capture native JSONL from Pi 1.1.0 using a local, deterministic model.
Run with python3 capture.py. No external model service or credentials are used.
"""
import json, os, pathlib, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

assert subprocess.check_output(["pi", "--version"], text=True).strip() == "1.1.0"
class Model(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        done = any(m["role"] == "tool" for m in request["messages"])
        delta = {"content": "Captured tool result."} if done else {"tool_calls": [{"index": 0, "id": "fixture-call", "type": "function", "function": {"name": "bash", "arguments": '{"command":"printf fixture-output"}'}}]}
        chunks = [{"id": "fixture-response", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                  {"id": "fixture-response", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop" if done else "tool_calls"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}]
        body = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers(); self.wfile.write(body.encode())
server = HTTPServer(("127.0.0.1", 0), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix="factorize-pi-fixture-") as root:
    config = pathlib.Path(root, "config"); config.mkdir()
    (config / "models.json").write_text(json.dumps({"providers": {"fixture": {"baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "api": "openai-completions", "apiKey": "local-fixture", "models": [{"id": "mock", "reasoning": False, "input": ["text"], "contextWindow": 128000, "maxTokens": 1024}]}}}))
    subprocess.run(["pi", "--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--model", "fixture/mock", "--tools", "bash", "--session-id", "factorize-fixture", "--session-dir", root + "/sessions", "-p", "Run printf fixture-output using bash, then report completion."], cwd=root, env={**os.environ, "PI_CODING_AGENT_DIR": str(config), "PI_TELEMETRY": "0"}, check=True, stdout=subprocess.DEVNULL, timeout=60)
    files = list(pathlib.Path(root, "sessions").glob("*.jsonl"))
    assert len(files) == 1
    pathlib.Path(__file__).with_name("native-session.jsonl").write_bytes(files[0].read_bytes())
server.shutdown()
