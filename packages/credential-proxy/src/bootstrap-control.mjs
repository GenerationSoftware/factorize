import { createServer } from "node:net";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { registerProxyBoot } from "./control-client.mjs";

const MAX_BOOTSTRAP_BYTES = 4096;

/** Local-only receiver for a provider exec channel; credentials never enter env or files. */
export async function startProxyBootstrapControl({ runtime, socketPath = "/run/factorize-proxy/bootstrap.sock", register = registerProxyBoot } = {}) {
  if (!runtime || typeof register !== "function") throw new TypeError("proxy bootstrap control requires a runtime and registrar");
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(socketPath), 0o700);
  await rm(socketPath, { force: true });
  const server = createServer((socket) => {
    let data = Buffer.alloc(0);
    let settled = false;
    let processing = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.end(`${JSON.stringify(value)}\n`);
    };
    socket.setTimeout(5000, () => finish({ error: "invalid bootstrap request" }));
    socket.on("data", async (chunk) => {
      if (settled || processing) return;
      if (data.byteLength + chunk.byteLength > MAX_BOOTSTRAP_BYTES) return finish({ error: "invalid bootstrap request" });
      data = Buffer.concat([data, chunk]);
      const end = data.indexOf(10);
      if (end < 0) return;
      if (end !== data.byteLength - 1) return finish({ error: "invalid bootstrap request" });
      let request;
      try { request = JSON.parse(data.subarray(0, end).toString("utf8")); }
      catch { return finish({ error: "invalid bootstrap request" }); }
      if (!request || typeof request !== "object" || Array.isArray(request)
          || Object.keys(request).sort().join(",") !== "bootEpoch,controlOrigin,credential"
          || request.bootEpoch !== runtime.bootEpoch || typeof request.credential !== "string"
          || !/^fzc_[A-Za-z0-9_-]{43}$/.test(request.credential)) {
        return finish({ error: "invalid bootstrap request" });
      }
      processing = true;
      socket.pause();
      socket.removeAllListeners("data");
      let credential = request.credential;
      try {
        const registration = await register({ controlOrigin: request.controlOrigin, token: credential, bootEpoch: runtime.bootEpoch });
        finish({ registered: true, proxyIdentity: registration.proxyIdentity, bootEpoch: registration.bootEpoch });
      } catch {
        finish({ error: "proxy boot registration failed" });
      } finally {
        credential = "";
        request.credential = "";
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { server.removeListener("error", reject); resolve(); });
  });
  await chmod(socketPath, 0o600);
  return Object.freeze({
    close: async () => {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(socketPath, { force: true });
    },
  });
}
