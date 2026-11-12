/** Standalone guest helper for the authenticated Fly-to-proxy TCP tunnel. */
export const FACTORIZE_FLY_TUNNEL_HELPER = String.raw`import { readFile } from "node:fs/promises";
import { connect as connectTls } from "node:tls";
import { createServer } from "node:net";

const root = "/home/exedev/.factorize-job/proxy";
const config = JSON.parse(await readFile(root + "/config.json", "utf8"));
const [key, cert, ca] = await Promise.all(["client.key", "client.crt", "ca.crt"].map(name => readFile(root + "/" + name)));
const tls = { key, cert, ca, rejectUnauthorized: true, servername: config.proxyServerName ?? config.proxyHost };
const server = createServer(local => {
  local.pause();
  let closed = false;
  local.once("close", () => { closed = true; });
  void (async () => {
    let attempt = 0;
    while (!closed && !local.destroyed) {
      let remote;
      try {
        remote = connectTls({ ...tls, host: config.proxyHost, port: config.proxyPort });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => remote.destroy(new Error("connect timeout")), 10000);
          remote.once("secureConnect", () => { clearTimeout(timeout); resolve(); });
          remote.once("error", error => { clearTimeout(timeout); reject(error); });
        });
        remote.write("FACTORIZE-TUNNEL/3 " + config.runId + "\n");
        await new Promise((resolve, reject) => {
          let response = "";
          const timeout = setTimeout(() => reject(new Error("tunnel timeout")), 10000);
          const onData = chunk => {
            response += chunk.toString("utf8");
            if (response.length > 128) { cleanup(); reject(new Error("invalid tunnel response")); }
            else if (response.includes("\n")) {
              cleanup();
              response === "FACTORIZE-TUNNEL/1 ACCEPTED\n" ? resolve() : reject(new Error("tunnel rejected"));
            }
          };
          const cleanup = () => { clearTimeout(timeout); remote.removeListener("data", onData); remote.removeListener("error", onError); };
          const onError = error => { cleanup(); reject(error); };
          remote.on("data", onData);
          remote.once("error", onError);
        });
        local.pipe(remote);
        remote.pipe(local);
        local.resume();
        remote.once("close", () => local.destroy());
        local.once("close", () => remote.destroy());
        return;
      } catch {
        remote?.destroy();
        if (closed || local.destroyed) return;
        const delay = Math.min(30000, 1000 * (2 ** Math.min(attempt++, 5)));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  })();
});
server.listen(config.localPort, "127.0.0.1");
`;
