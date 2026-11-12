import { createServer } from "node:net";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { registerProxyBoot } from "./control-client.mjs";

const MAX_BOOTSTRAP_BYTES = 4096;

/** Local-only receiver for a provider exec channel; credentials never enter env or files. */
export async function startProxyBootstrapControl({ runtime, socketPath = "/run/factorize-proxy/bootstrap.sock", register = registerProxyBoot, onRegistered = () => {}, issueVmCertificate } = {}) {
  if (!runtime || typeof register !== "function" || typeof onRegistered !== "function"
      || (issueVmCertificate !== undefined && typeof issueVmCertificate !== "function")) throw new TypeError("proxy bootstrap control requires a runtime, registrar, and registration callback");
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
      if (request?.type === "issue-vm-certificate") {
        if (!issueVmCertificate || request.bootEpoch !== runtime.bootEpoch
            || typeof request.vmIdentity !== "string" || typeof request.csr !== "string"
            || Object.keys(request).sort().join(",") !== "bootEpoch,csr,type,vmIdentity") {
          return finish({ error: "invalid certificate request" });
        }
        processing = true;
        socket.pause();
        socket.removeAllListeners("data");
        try {
          const issued = await issueVmCertificate({ vmIdentity: request.vmIdentity, csr: request.csr, bootEpoch: runtime.bootEpoch });
          if (typeof issued?.certificate !== "string" || typeof issued?.trustBundle !== "string") throw new Error("invalid certificate response");
          finish({ issued: true, bootEpoch: runtime.bootEpoch, vmIdentity: request.vmIdentity, certificate: issued.certificate, trustBundle: issued.trustBundle });
        } catch {
          finish({ error: "certificate provisioning failed" });
        } finally {
          request.csr = "";
        }
        return;
      }
      if (request?.type !== "register-boot") return finish({ error: "invalid bootstrap request" });
      if (!request || typeof request !== "object" || Array.isArray(request)
          || Object.keys(request).sort().join(",") !== "bootEpoch,browserOrigin,controlOrigin,credential,type"
          || request.bootEpoch !== runtime.bootEpoch || typeof request.credential !== "string"
          || typeof request.browserOrigin !== "string"
          || !/^fzc_[A-Za-z0-9_-]{43}$/.test(request.credential)) {
        return finish({ error: "invalid bootstrap request" });
      }
      processing = true;
      socket.pause();
      socket.removeAllListeners("data");
      let credential = request.credential;
      try {
        const registration = await register({ controlOrigin: request.controlOrigin, token: credential, bootEpoch: runtime.bootEpoch, browserOrigin: request.browserOrigin });
        // Keep the exchanged proxy credential inside the proxy process. The
        // one-shot startup command receives only the public registration result.
        await onRegistered(registration, { controlOrigin: request.controlOrigin, browserOrigin: request.browserOrigin, bootEpoch: runtime.bootEpoch });
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
