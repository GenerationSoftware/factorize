import { createInterface } from "node:readline";
import { createProxyRuntime } from "./runtime.mjs";

const runtime = createProxyRuntime();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing = false;
let shutdownDeadline;

function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function stop() {
  if (closing) return;
  closing = true;
  await runtime.shutdown();
  lines.close();
  clearTimeout(shutdownDeadline);
  process.exit(0);
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);
shutdownDeadline = setTimeout(() => process.exit(1), 2_000);
shutdownDeadline.unref();
respond({ type: "ready", state: runtime.state });

lines.on("line", async (line) => {
  if (closing) return;
  let command;
  try {
    command = JSON.parse(line);
    if (command?.type === "status") respond({ type: "status", state: runtime.state });
    else if (command?.type === "unlock") {
      runtime.unlock(command.key);
      respond({ type: "status", state: runtime.state });
    } else if (command?.type === "lock") {
      await runtime.lock();
      respond({ type: "status", state: runtime.state });
    } else if (command?.type === "stop") stop();
    else respond({ type: "error", error: "unsupported command" });
  } catch {
    respond({ type: "error", error: "invalid command" });
  }
});
