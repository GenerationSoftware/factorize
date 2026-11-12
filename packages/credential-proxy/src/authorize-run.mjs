import { connect } from "node:net";

const SOCKET_PATH = "/run/factorize-proxy/bootstrap.sock";
const MAX_REQUEST_BYTES = 4096;
const MAX_RESPONSE_BYTES = 2048;

async function readRequest() {
  let length = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    length += chunk.byteLength;
    if (length > MAX_REQUEST_BYTES) throw new Error("invalid run authorization request");
    chunks.push(chunk);
  }
  if (!length || chunks.at(-1).at(-1) !== 10) throw new Error("invalid run authorization request");
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "credential,runId,vmIdentity"
      || typeof value.credential !== "string" || typeof value.runId !== "string" || typeof value.vmIdentity !== "string") throw new Error("invalid run authorization request");
  return { type: "authorize-run", ...value };
}

async function send(request) {
  const socket = connect(SOCKET_PATH);
  try {
    return await new Promise((resolve, reject) => {
      let data = Buffer.alloc(0);
      socket.on("data", chunk => {
        data = Buffer.concat([data, chunk]);
        if (data.length > MAX_RESPONSE_BYTES) { reject(new Error("invalid run authorization response")); socket.destroy(); return; }
        const end = data.indexOf(10);
        if (end < 0) return;
        try { resolve(JSON.parse(data.subarray(0, end).toString("utf8"))); }
        catch { reject(new Error("invalid run authorization response")); }
        socket.end();
      });
      socket.once("error", () => reject(new Error("proxy run authorization service unavailable")));
      socket.setTimeout(7000, () => reject(new Error("proxy run authorization service timed out")));
      socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    });
  } finally { socket.destroy(); }
}

try {
  const request = await readRequest();
  const result = await send(request);
  if (result?.authorized !== true || result.runId !== request.runId || result.vmIdentity !== request.vmIdentity) throw new Error("run authorization was not confirmed");
  process.stdout.write("Run credential delivered to proxy memory\n");
} catch {
  process.stderr.write("Run credential delivery failed\n");
  process.exitCode = 1;
}
