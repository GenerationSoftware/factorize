import { createInterface } from "node:readline";
import { createProxyRuntime } from "./runtime.mjs";
import { createControlServer } from "./control.mjs";

const runtime = createProxyRuntime();
const controlConfigured = ["PROXY_ID", "PROXY_OWNER_ID", "PROXY_GENERATION", "FACTORIZE_WEB_ORIGIN", "FACTORIZE_CAPABILITY_PUBLIC_KEY"].every((name) => process.env[name]);
const controlServer = controlConfigured ? createControlServer({
  runtime,
  proxyId: process.env.PROXY_ID,
  ownerId: process.env.PROXY_OWNER_ID,
  generation: Number(process.env.PROXY_GENERATION),
  origin: process.env.FACTORIZE_WEB_ORIGIN,
  publicKey: process.env.FACTORIZE_CAPABILITY_PUBLIC_KEY,
}) : undefined;
if (controlServer) controlServer.listen(Number(process.env.PROXY_CONTROL_PORT ?? 8787), process.env.PROXY_CONTROL_HOST ?? "0.0.0.0");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing = false;
let shutdownDeadline;

function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function stop() {
  if (closing) return;
  closing = true;
  runtime.shutdown();
  controlServer?.close();
  lines.close();
  clearTimeout(shutdownDeadline);
  process.exit(0);
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);
shutdownDeadline = setTimeout(() => process.exit(1), 2_000);
shutdownDeadline.unref();
respond({ type: "ready", state: runtime.state });

lines.on("line", (line) => {
  if (closing) return;
  let command;
  try {
    command = JSON.parse(line);
    if (command?.type === "status") respond({ type: "status", state: runtime.state });
    else if (command?.type === "stop") stop();
    else respond({ type: "error", error: "unsupported command" });
  } catch {
    respond({ type: "error", error: "invalid command" });
  }
});
