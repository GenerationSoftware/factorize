import { createServer } from "node:https";
import type { AddressInfo } from "node:net";

/** Serve the application's real Fetch handler over local HTTPS. No routes are reimplemented. */
export async function startLocalApiServer(options: { key: string | Buffer; cert: string | Buffer; fetch: (request: Request) => Promise<Response> }) {
  const server = createServer({ key: options.key, cert: options.cert }, async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > 12_000_000) throw new Error("Request too large"); chunks.push(chunk); }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(`https://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers,
        ...(["GET", "HEAD"].includes(incoming.method!) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await options.fetch(request);
      const responseHeaders: Record<string, string> = {}; response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500).end("Local API request failed"); }
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", () => resolve()); });
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
