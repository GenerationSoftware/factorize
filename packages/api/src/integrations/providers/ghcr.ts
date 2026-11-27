import { fetchWithoutRedirects } from "../../transport/http/fetch-without-redirects";
import { AgentApiError } from "../../proxy/api/agent-api-error";
import { ghcrImage } from "../api/ghcr-contracts";

export const ghcrOrigin = "https://ghcr.io";
const tag = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const invalid = () => new AgentApiError(400, "invalid_request", "Use GET or HEAD for tags or manifests of the configured GHCR image.");
export const ghcrAccept = [
  "application/vnd.oci.image.manifest.v1+json", "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.docker.distribution.manifest.list.v2+json",
].join(", ");

export function ghcrReadPath(image: string, path: string, method: string) {
  if (method !== "GET" && method !== "HEAD" || !ghcrImage.safeParse(image).success) throw invalid();
  const prefix = "/v2/" + image + "/";
  if (!path.startsWith("/") || /[\\#\u0000-\u0020]/.test(path)) throw invalid();
  const [resource, query, unexpected] = path.slice(1).split("?");
  if (unexpected !== undefined) throw invalid();
  if (resource === "tags/list") {
    const clean = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(query)) {
      if (clean.has(key) || (key === "n" ? !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100 : key !== "last" || !tag.test(value))) throw invalid();
      clean.set(key,value);
    }
    if (!clean.has("n")) clean.set("n","100");
    return prefix + resource + "?" + clean;
  }
  const manifest = /^manifests\/([^/]+)$/.exec(resource);
  if (manifest && query === undefined && (tag.test(manifest[1]) || digest.test(manifest[1]))) return prefix + resource;
  throw invalid();
}

export async function ghcrToken(credential: { image: string; username: string; token: string }, options: {
  actions?: "pull" | "pull,push"; fetcher?: typeof fetch; signal?: AbortSignal;
} = {}) {
  const url = new URL("/token", ghcrOrigin);
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", "repository:" + credential.image + ":" + (options.actions ?? "pull"));
  const timeout = AbortSignal.timeout(8000);
  const response = await fetchWithoutRedirects(url, { signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: { Authorization: "Basic " + btoa(credential.username + ":" + credential.token), Accept: "application/json" },
  }, options.fetcher);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw new AgentApiError(403, "forbidden", "GitHub denied this GHCR credential or image.");
    throw new AgentApiError(502, "credential_unavailable", "GitHub could not issue a registry token.");
  }
  // Bound the token envelope before parsing; provider data never reaches callers.
  const reader = response.body?.getReader();
  if (!reader) throw new AgentApiError(502, "credential_unavailable", "GitHub returned an invalid registry token.");
  const decoder = new TextDecoder();
  let bytes = 0, value = "";
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 32768) throw new Error();
      value += decoder.decode(item.value, { stream: true });
    }
    const body: unknown = JSON.parse(value + decoder.decode());
    const {token, access_token} = body as {token?: unknown;access_token?: unknown};
    const secret = token ?? access_token;
    if (typeof secret === "string" && /^[A-Za-z0-9._~+\/=-]{1,8192}$/.test(secret)) return secret;
    throw new Error();
  } catch {
    void reader.cancel().catch(() => {});
    throw new AgentApiError(502, "credential_unavailable", "GitHub returned an invalid registry token.");
  } finally { reader.releaseLock(); }
}
