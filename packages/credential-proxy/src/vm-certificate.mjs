import { connect } from "node:net";

const SOCKET_PATH = "/run/factorize-proxy/bootstrap.sock";
const MAX_REQUEST_BYTES = 20 * 1024;
const MAX_RESPONSE_BYTES = 40 * 1024;

async function readRequest() {
  let length = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    length += chunk.byteLength;
    if (length > MAX_REQUEST_BYTES) throw new Error("invalid certificate request");
    chunks.push(chunk);
  }
  if (!length || chunks.at(-1).at(-1) !== 10) throw new Error("invalid certificate request");
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "bootEpoch,csr,vmIdentity"
      || typeof value.bootEpoch !== "string" || typeof value.csr !== "string" || typeof value.vmIdentity !== "string") {
    throw new Error("invalid certificate request");
  }
  return { type: "issue-vm-certificate", ...value };
}

async function send(request) {
  const socket = connect(SOCKET_PATH);
  try {
    return await new Promise((resolve, reject) => {
      let data = Buffer.alloc(0);
      socket.on("data", chunk => {
        data = Buffer.concat([data, chunk]);
        if (data.length > MAX_RESPONSE_BYTES) {
          reject(new Error("invalid certificate response"));
          socket.destroy();
          return;
        }
        const end = data.indexOf(10);
        if (end < 0) return;
        try { resolve(JSON.parse(data.subarray(0, end).toString("utf8"))); }
        catch { reject(new Error("invalid certificate response")); }
        socket.end();
      });
      socket.once("error", () => reject(new Error("proxy certificate service unavailable")));
      socket.setTimeout(7000, () => reject(new Error("proxy certificate service timed out")));
      socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    });
  } finally {
    socket.destroy();
  }
}

try {
  const request = await readRequest();
  const result = await send(request);
  if (result?.issued !== true || result.bootEpoch !== request.bootEpoch || result.vmIdentity !== request.vmIdentity
      || typeof result.certificate !== "string" || typeof result.trustBundle !== "string") throw new Error("VM certificate was not issued");
  process.stdout.write(`${JSON.stringify({ bootEpoch: result.bootEpoch, vmIdentity: result.vmIdentity, certificate: result.certificate, trustBundle: result.trustBundle })}\n`);
} catch {
  process.stderr.write("VM certificate provisioning failed\n");
  process.exitCode = 1;
}
