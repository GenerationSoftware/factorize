/** Installed inside run-owned VMs. It handles only vendor identity and streams
 * to Factorize; upstream credentials never enter this process or its config. */
export const RUN_IDENTITY_GUEST_HELPER = String.raw`import { readFile } from "node:fs/promises";
import { request as httpRequest, createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

function validate(config) {
  if (!config || !/^[0-9a-f-]{36}$/.test(config.runId)) throw new Error("Invalid run identity configuration");
  const origin = new URL(config.backendOrigin);
  if (origin.protocol !== "https:" || origin.origin !== config.backendOrigin || origin.username || origin.password) throw new Error("Invalid backend origin");
  if (config.provider !== "exe.dev" && config.provider !== "fly.io") throw new Error("Unsupported VM identity provider");
  if (config.provider === "exe.dev" && !/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(config.integrationName ?? "")) throw new Error("Invalid WIF integration");
}
function requireToken(value) {
  if (typeof value !== "string" || value.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim())) throw new Error("Vendor identity unavailable");
  return value.trim();
}
export async function vendorToken(config, fetcher = fetch) {
  validate(config);
  if (config.provider === "exe.dev") {
    const response = await fetcher("https://" + config.integrationName + ".int.exe.xyz/token", {redirect: "error", signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("Vendor identity unavailable");
    const result = await response.json();
    return requireToken(result.token);
  }
  const body = JSON.stringify({aud: "factorize://runs/" + config.runId});
  const token = await new Promise((resolve, reject) => {
    const request = httpRequest({socketPath: "/.fly/api", path: "/v1/tokens/oidc", method: "POST", headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)}, timeout: 10000}, response => {
      let value = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { value += chunk; if (value.length > 16384) request.destroy(new Error("Vendor identity unavailable")); });
      response.on("end", () => response.statusCode === 200 ? resolve(value) : reject(new Error("Vendor identity unavailable")));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Vendor identity unavailable")));
    request.on("error", reject);
    request.end(body);
  });
  return requireToken(token);
}

export function createRunIdentityProxy(config, {getToken = () => vendorToken(config), fetcher = fetch} = {}) {
  validate(config);
  return createServer(async (incoming, outgoing) => {
    if (incoming.url === "/_factorize/ready") { outgoing.writeHead(200, {"Content-Type": "text/plain"}).end("ready"); return; }
    const abort = new AbortController();
    outgoing.on("close", () => { if (!outgoing.writableFinished) abort.abort(); });
    try {
      if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//") || incoming.url.includes("\\")) throw new Error("Invalid local request");
      const url = new URL(incoming.url, "http://127.0.0.1");
      let path;
      if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/") || url.pathname === "/mcp") path = url.pathname;
      else if (/^\/internal\/run-(?:artifacts|trace-chunks)\/[^/]+$/.test(url.pathname)) path = url.pathname;
      else if (url.pathname === "/integrations") path = "/api/v1/runtime-integrations";
      else if (url.pathname.startsWith("/integrations/") || url.pathname.startsWith("/providers/") || url.pathname.startsWith("/x/")) path = "/internal/run-proxy/" + config.runId + url.pathname;
      else { outgoing.writeHead(404).end(); return; }
      const token = requireToken(await getToken());
      const headers = new Headers();
      const blocked = new Set(["host", "authorization", "cookie", "connection", "keep-alive", "proxy-authorization", "proxy-authenticate", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "expect", "x-factorize-run-id"]);
      const connectionTokens = new Set(String(incoming.headers.connection ?? "").toLowerCase().split(",").map(value => value.trim()));
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined && !blocked.has(name) && !connectionTokens.has(name) && !name.startsWith("x-forwarded-") && name !== "forwarded") headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      if (/^\/internal\/run-(?:artifacts|trace-chunks)\//.test(path) && typeof incoming.headers["content-length"] === "string" && /^[0-9]+$/.test(incoming.headers["content-length"])) headers.set("Content-Length", incoming.headers["content-length"]);
      headers.set("Authorization", "Bearer " + token);
      headers.set("X-Factorize-Run-Id", config.runId);
      const method = incoming.method ?? "GET";
      const response = await fetcher(config.backendOrigin + path + url.search, {
        method, headers, body: method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming), duplex: "half",
        redirect: "manual", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60 * 1000)]),
      });
      const output = {};
      const privateResponseHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "set-cookie", "content-length", "content-encoding"]);
      const responseConnectionTokens = new Set((response.headers.get("connection") ?? "").toLowerCase().split(",").map(value => value.trim()));
      response.headers.forEach((value, name) => { if (!privateResponseHeaders.has(name) && !responseConnectionTokens.has(name)) output[name] = value; });
      outgoing.writeHead(response.status, output);
      if (!response.body) outgoing.end();
      else await pipeline(Readable.fromWeb(response.body), outgoing);
    } catch {
      abort.abort();
      if (!outgoing.headersSent) outgoing.writeHead(502, {"Content-Type": "text/plain", "Cache-Control": "no-store"}).end("Factorize run access unavailable");
      else outgoing.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(process.argv[2] ?? "/run/factorize-identity/config.json", "utf8"));
  const server = createRunIdentityProxy(config);
  server.listen(config.localPort ?? 18180, "127.0.0.1");
}
`;
