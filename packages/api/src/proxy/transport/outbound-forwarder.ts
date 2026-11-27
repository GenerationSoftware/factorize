import { proxyLimits } from "../../config/limits";
/** Streaming HTTP egress for the backend Worker. The deployment must retain
 * global_fetch_strictly_public: fetch never uses private zone-origin routing.
 * Destinations and credentials are resolved server-side before this function. */
export type OutboundCredential = {
  origin: string; path: string; credential: string;
  authorization?: "bearer" | "github-git-basic" | "raw" | "none";
  headers?: Record<string, string>;
  /** Opt-in egress allowlist for integrations with alternative auth headers. */
  requestHeaders?: readonly string[];
  /** Set only from an owner-configured model endpoint. */
  allowInsecureHttp?:boolean;
};
const hop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const privateHeaders = new Set(["host", "authorization", "cookie", "content-length", "expect", "forwarded", "x-factorize-event-id"]);

function filteredHeaders(input: Headers, request: boolean, allow?: readonly string[]): Headers {
  const result = new Headers();
  const connectionTokens = new Set((input.get("connection") ?? "").toLowerCase().split(",").map(s => s.trim()));
  input.forEach((value, key) => {
    const name = key.toLowerCase();
    if (allow && !allow.includes(name)) return;
    if ((!request && /(?:authorization|cookie|api[-_]?key|token|secret)/i.test(name)) || hop.has(name) || connectionTokens.has(name) || (request && (privateHeaders.has(name) || name.startsWith("x-forwarded-") || name.startsWith("sec-") || name.startsWith("cf-") || name === "origin" || name === "referer")) || (!request && (name === "set-cookie" || name === "authorization" || name === "proxy-authorization"))) return;
    result.set(key, value);
  });
  return result;
}

function bounded(body: ReadableStream<Uint8Array> | null, bytes: number, abort: AbortController): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  let read = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    read += chunk.byteLength;
    if (read > bytes) { abort.abort(); throw new Error("Proxy stream limit exceeded"); }
    controller.enqueue(chunk);
  } }));
}

/** A single-origin protocol request. No redirects, body buffering, guest
 * credentials, or upstream Set-Cookie propagation. Git-Protocol is preserved. */
export async function forwardOutbound(request: Request, selected: OutboundCredential, options: {
  fetcher?: typeof fetch; requestBytes?: number; responseBytes?: number; timeoutMs?: number;
} = {}): Promise<Response> {
  const configured = new URL(selected.origin);
  if ((configured.protocol !== "https:" && !(configured.protocol==="http:" && selected.allowInsecureHttp)) || configured.origin !== selected.origin || configured.username || configured.password
      || !selected.path.startsWith("/") || selected.path.includes("\\") || /[\r\n\0]/.test(selected.path)
      || (selected.authorization!=="none" && !selected.credential) || /[\r\n]/.test(selected.credential)) throw new Error("Invalid outbound credential binding");
  const target = new URL(selected.origin);
  const separator = selected.path.indexOf("?");
  target.pathname = separator < 0 ? selected.path : selected.path.slice(0, separator);
  target.search = separator < 0 ? "" : selected.path.slice(separator);
  const headers = filteredHeaders(request.headers, true, selected.requestHeaders);
  if(selected.authorization!=="none")headers.set("Authorization", selected.authorization === "github-git-basic" ? `Basic ${btoa(`x-access-token:${selected.credential}`)}` : selected.authorization === "raw" ? selected.credential : `Bearer ${selected.credential}`);
  headers.set("Accept-Encoding", "identity");
  headers.set("User-Agent", "Factorize-API-Proxy");
  for (const [name, value] of Object.entries(selected.headers ?? {})) headers.set(name, value);
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(options.timeoutMs ?? proxyLimits.timeoutMs)]);
  const response = await (options.fetcher ?? fetch)(target, {
    method: request.method, headers, signal, redirect: "manual", cache: "no-store",
    body: request.method === "GET" || request.method === "HEAD" ? undefined : bounded(request.body, options.requestBytes ?? proxyLimits.requestBytes, abort),
    ...({duplex: "half"} as RequestInit),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("Upstream redirects are not permitted");
  }
  const output = filteredHeaders(response.headers, false);
  output.delete("Content-Length");
  output.set("Cache-Control", "no-store");
  return new Response(bounded(response.body, options.responseBytes ?? proxyLimits.responseBytes, abort), { status: response.status, statusText: response.statusText, headers: output });
}
