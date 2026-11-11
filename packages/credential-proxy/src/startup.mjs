import { connect } from "node:net";
import { once } from "node:events";

const SOCKET_PATH = "/run/factorize-proxy/bootstrap.sock";
const MAX_BYTES = 4096;

async function readRequest() {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength;
    if (bytes > MAX_BYTES) throw new Error("invalid bootstrap request");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (!data.byteLength || data[data.byteLength - 1] !== 10) throw new Error("invalid bootstrap request");
  return data;
}

async function main() {
  const request = await readRequest();
  const socket = connect(SOCKET_PATH);
  const result = new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      const end = data.indexOf(10);
      if (end >= 0) {
        try { resolve(JSON.parse(data.subarray(0, end).toString("utf8"))); }
        catch { reject(new Error("invalid bootstrap response")); }
        socket.end();
      }
    });
    socket.once("error", () => reject(new Error("proxy startup control unavailable")));
    socket.setTimeout(7000, () => reject(new Error("proxy startup control timed out")));
  });
  socket.write(request);
  const response = await result;
  if (response.registered !== true) throw new Error("proxy boot registration failed");
  process.stdout.write("Credential proxy started\n");
}

main().catch(() => {
  process.stderr.write("Credential proxy startup failed\n");
  process.exitCode = 1;
});
