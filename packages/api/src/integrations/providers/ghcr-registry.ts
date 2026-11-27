import { AgentApiError } from "../../proxy/api/agent-api-error";
import { ghcrImage } from "../api/ghcr-contracts";
import { ghcrAccept, ghcrOrigin, ghcrToken } from "./ghcr";

type GhcrCredential = { image: string; username: string; token: string };
type RegistryAccess = { pull: boolean; push: boolean };
type RegistryOptions = { fetcher?: typeof fetch; recheck?: () => Promise<void> };

const digest = /^sha256:[0-9a-f]{64}$/;
const tag = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const uploadId = /^[A-Za-z0-9_-]{1,200}$/;
const uploadState = /^[a-zA-Z0-9_~+=/-]{1,2048}$/;
const blobHost = "https://pkg-containers.githubusercontent.com";
const commonHeaders = { "Docker-Distribution-API-Version": "registry/2.0", "Cache-Control": "private, no-store, no-transform" };

export function ghcrRegistryError(status: number, code: string, message: string, retryAfter?: string | null): Response {
  return Response.json({ errors: [{ code, message }] }, { status,
    headers: { ...commonHeaders, ...(retryAfter && /^\d{1,8}$/.test(retryAfter) ? { "Retry-After": retryAfter } : {}) } });
}

type Route = { path: string; kind: "manifest" | "blob" | "tags" | "start" | "session" | "referrers"; push: boolean; digest?: string };

function inspectRoute(image: string, url: URL, method: string): Route | undefined {
  const prefix = "/v2/" + image + "/";
  if (!ghcrImage.safeParse(image).success || !url.pathname.startsWith(prefix) || url.search.length > 4096) return;
  const part = url.pathname.slice(prefix.length);
  const values = url.searchParams;
  const validQuery = (...keys: string[]) => [...values.keys()].every(key => keys.includes(key) && values.getAll(key).length === 1);
  const wantedDigest = values.get("digest");
  const ref = /^manifests\/([^/]+)$/.exec(part)?.[1];
  if (ref && (tag.test(ref) || digest.test(ref)) && validQuery() && ["GET","HEAD","PUT"].includes(method))
    return { path: prefix + part, kind: "manifest", push: method === "PUT", digest: digest.test(ref) ? ref : undefined };
  const blob = /^blobs\/([^/]+)$/.exec(part)?.[1];
  if (blob && digest.test(blob) && validQuery() && ["GET","HEAD"].includes(method))
    return { path: prefix + part, kind: "blob", push: false, digest: blob };
  const subject = /^referrers\/([^/]+)$/.exec(part)?.[1];
  if (subject && digest.test(subject) && validQuery("artifactType") && ["GET","HEAD"].includes(method)) {
    const type = values.get("artifactType");
    if (type !== null && !/^[A-Za-z0-9.+_-]{1,80}\/[A-Za-z0-9.+_-]{1,150}$/.test(type)) return;
    return { path: prefix + part + url.search, kind: "referrers", push: false };
  }
  if (part === "tags/list" && ["GET","HEAD"].includes(method) && validQuery("n","last")) {
    const n = values.get("n"), last = values.get("last");
    if (n !== null && (!/^[1-9]\d{0,2}$/.test(n) || Number(n)>100) || last !== null && !tag.test(last)) return;
    const query = new URLSearchParams({ n: n ?? "100", ...(last === null ? {} : { last }) });
    return { path: prefix + part + "?" + query, kind: "tags", push: false };
  }
  if (part === "blobs/uploads/" && method === "POST" && validQuery("digest","mount","from","digest-algorithm")) {
    if (wantedDigest !== null && !digest.test(wantedDigest)) return;
    const mount = values.get("mount"), from = values.get("from");
    if (mount !== null && !digest.test(mount) || from !== null && (mount === null || !ghcrImage.safeParse(from).success)) return;
    if (values.has("digest-algorithm") && values.get("digest-algorithm") !== "sha256") return;
    // Treat mounts as ordinary upload starts. Do not request a second image scope.
    return { path: prefix + part + (wantedDigest ? "?" + new URLSearchParams({ digest: wantedDigest }) : ""), kind: "start", push: true, digest: wantedDigest ?? undefined };
  }
  const session = /^blobs\/uploads\/([^/]+)$/.exec(part)?.[1];
  if (session && uploadId.test(session) && ["GET","HEAD","PATCH","PUT","DELETE"].includes(method) && validQuery("_state","digest")) {
    const state = values.get("_state");
    if (state !== null && !uploadState.test(state)) return;
    if (method === "PUT" ? wantedDigest === null || !digest.test(wantedDigest) : wantedDigest !== null) return;
    return { path: prefix + part + url.search, kind: "session", push: true, digest: wantedDigest ?? undefined };
  }
}

export function ghcrRegistryPing() { return new Response(null, { headers: commonHeaders }); }

function readHeaders(request: Request, route: Route, cdn = false) {
  const headers = new Headers({ "Accept-Encoding": "identity" });
  const allowed = cdn ? ["range", "if-range"] :
    route.kind === "blob" ? ["range","if-range","if-none-match","if-modified-since"] :
    route.push ? ["content-type","content-range","content-length","accept"] : ["accept","if-none-match","if-modified-since"];
  for (const name of allowed) {
    const value = request.headers.get(name);
    if (value !== null && value.length <= 1024) headers.set(name,value);
  }
  if (!cdn && route.kind === "manifest" && !route.push && !headers.has("Accept")) headers.set("Accept",ghcrAccept);
  return headers;
}

function downloadTarget(location: string | null, target: URL, route: Route, status: number) {
  if (route.kind !== "blob" || ![302,303,307,308].includes(status) || !location || location.length > 8192) return;
  try {
    const url = new URL(location,target);
    const blob = /^\/ghcr[0-9]+\/blobs\/([^/]+)$/.exec(url.pathname);
    if (url.origin === blobHost && !url.username && !url.password && !url.hash && blob?.[1] === route.digest) return url;
  } catch { /* fail closed without exposing a signed Location */ }
}

function rewriteLocation(location: string, target: URL, image: string, route: Route, status: number) {
  if (!route.push || ![201,202,204,416].includes(status) || location.length > 4096) return;
  try {
    const url = new URL(location,target);
    if (url.origin !== ghcrOrigin || url.username || url.password || url.hash) return;
    const candidate = inspectRoute(image,url,"GET");
    if (candidate?.kind === "session" && [202,204,416].includes(status)) return candidate.path;
    if (candidate?.kind === "blob" && status === 201 && (!route.digest || route.digest === candidate.digest)) return candidate.path;
    if (candidate?.kind === "manifest" && route.kind === "manifest" && status === 201) return candidate.path;
  } catch { /* unrecognized locations are not forwarded */ }
}

function uploadBody(request: Request, headers: Headers): ReadableStream<Uint8Array> | undefined {
  const body = request.body;
  const rawLength = headers.get("Content-Length");
  if (!body || rawLength === null) return body ?? undefined;
  const length = Number(rawLength);
  if (!/^\d{1,16}$/.test(rawLength) || !Number.isSafeInteger(length)) {
    headers.delete("Content-Length");
    return body;
  }
  // Workerd derives Content-Length from the stream rather than the header. Preserve
  // Docker's known length without buffering the layer or trusting a false length.
  if (typeof FixedLengthStream !== "undefined") {
    const fixed = new FixedLengthStream(length);
    void body.pipeTo(fixed.writable, { signal: request.signal }).catch(() => {});
    return fixed.readable;
  }
  return body;
}

function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
function unavailable() { return ghcrRegistryError(502,"UNKNOWN","The upstream GitHub registry response could not be used."); }

/** Authenticate separately at the public host. The caller supplies the one authorized image and live grant. */
export async function forwardGhcrRegistry(request: Request, credential: GhcrCredential, access: RegistryAccess, options: RegistryOptions = {}): Promise<Response> {
  const method = request.method;
  const route = inspectRoute(credential.image,new URL(request.url),method);
  if (!route) return ghcrRegistryError(404,"NAME_UNKNOWN","This registry path is not available.");
  if (route.push ? !access.push : !access.pull && !(access.push && method === "HEAD" && (route.kind === "blob" || route.kind === "manifest")))
    return ghcrRegistryError(403,"DENIED","This client does not have permission for this registry operation.");
  const fetcher = options.fetcher ?? fetch;
  const target = new URL(route.path, ghcrOrigin);
  let token: string;
  try {
    token = await ghcrToken(credential,{actions: route.push ? "pull,push" : "pull",fetcher,signal:request.signal});
  } catch (error) {
    if (error instanceof AgentApiError && error.status === 403) return ghcrRegistryError(403,"DENIED","GitHub denied access to this image.");
    return unavailable();
  }
  await options.recheck?.();
  const headers = readHeaders(request,route);
  headers.set("Authorization","Bearer " + token);
  let response: Response;
  const body = ["POST","PATCH","PUT"].includes(method) ? uploadBody(request, headers) : undefined;
  try {
    response = await fetcher(target,{method,headers,body,redirect:"manual",signal:request.signal,...({duplex:"half"} as RequestInit)});
  } catch { return unavailable(); }
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    const destination = downloadTarget(response.headers.get("Location"),target,route,response.status);
    discard(response);
    if (!destination) return unavailable();
    await options.recheck?.();
    try { response = await fetcher(destination,{method,headers:readHeaders(request,route,true),redirect:"manual",signal:request.signal}); }
    catch { return unavailable(); }
    if (!response.ok && response.status !== 304) { discard(response); return unavailable(); }
  }

  if (!response.ok && response.status !== 304 && response.status !== 416) {
    discard(response);
    if ([401,403].includes(response.status)) return ghcrRegistryError(403,"DENIED","GitHub denied access to this image.");
    if (response.status === 404) return ghcrRegistryError(404,route.kind === "blob" ? "BLOB_UNKNOWN" : route.kind === "session" ? "BLOB_UPLOAD_UNKNOWN" : "MANIFEST_UNKNOWN","The requested registry object was not found.");
    if (response.status === 429) return ghcrRegistryError(429,"TOOMANYREQUESTS","GitHub limited registry requests.",response.headers.get("Retry-After"));
    if ([400,405,409,413,415,422].includes(response.status)) return ghcrRegistryError(response.status,"UNKNOWN","GitHub rejected this registry operation.");
    return unavailable();
  }

  const output = new Headers(commonHeaders);
  const safeHeaders: Record<string, RegExp> = {
    "content-type": /^[\x20-\x7e]{1,250}$/,
    "content-length": /^\d{1,16}$/,
    "content-range": /^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/,
    "accept-ranges": /^(?:bytes|none)$/,
    "range": /^(?:bytes=)?\d+-\d+$/,
    "docker-content-digest": digest,
    "docker-upload-uuid": uploadId,
    "oci-chunk-min-length": /^\d{1,16}$/,
    "etag": /^(?:W\/)?"[A-Za-z0-9_.:+/-]{1,200}"$/,
    "last-modified": /^[A-Za-z0-9,: ]{1,80}$/,
  };
  for (const [name,rx] of Object.entries(safeHeaders)) {
    const value = response.headers.get(name);
    if (value !== null && rx.test(value)) output.set(name,value);
  }
  const location = response.headers.get("Location");
  const rewritten = location && rewriteLocation(location,target,credential.image,route,response.status);
  if (rewritten) output.set("Location",rewritten);
  else if (response.status === 201 && route.push) {
    // A completion may return a signed storage URL; emit a registry-local URL instead.
    if (route.kind === "manifest") output.set("Location", target.pathname);
    else {
      const committed = route.digest ?? output.get("Docker-Content-Digest");
      if (!committed) { discard(response); return unavailable(); }
      output.set("Location", "/v2/" + credential.image + "/blobs/" + committed);
    }
  }
  if (route.push && [202,416].includes(response.status) && !rewritten) { discard(response); return unavailable(); }
  if (route.kind === "session" && response.status === 204 && (method === "GET" || method === "HEAD") && !rewritten) { discard(response); return unavailable(); }
  return new Response(method === "HEAD" ? null : response.body,{status:response.status,headers:output});
}
