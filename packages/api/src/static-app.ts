import type { Env } from "./types";

export const STATIC_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const pages = new Set(["/", "/jobs", "/jobs/new", "/projects", "/projects/new", "/job-runs", "/settings", "/settings/integrations", "/settings/api-keys", "/settings/api-keys/new", "/settings/authorized-clients", "/settings/password", "/auth/login", "/auth/signup", "/auth/password-reset", "/auth/verify", "/auth/verify/request", "/authorize", "/device"]);
const backendNamespaces = ["/api", "/healthz", "/auth", "/oauth", "/webhooks", "/internal", "/mcp", "/.well-known"];
function isBackendNamespace(path: string) {
  return backendNamespaces.some(namespace => path === namespace || path.startsWith(`${namespace}/`));
}
export function isStaticPage(path: string) {
  return pages.has(path) ||
    /^\/jobs\/[^/]+(?:\/edit|\/settings)?$/.test(path) ||
    /^\/projects\/[^/]+$/.test(path) ||
    /^\/job-runs\/[^/]+(?:\/(?:trace|info|context|settings))?$/.test(path) ||
    /^\/skills(?:\/[^/]+)?$/.test(path) ||
    (path.startsWith("/settings/") && !isBackendNamespace(path));
}
export function isStaticAsset(path: string) {
  return /^\/assets\/[A-Za-z0-9_.-]+$/.test(path) || path === "/styles.css";
}
export function securityHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", STATIC_CSP);
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (new URL(request.url).protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
/** Safe application fallback. ASSETS never receives a backend path or a write method. */
export async function staticApp(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!isStaticPage(path) && !isStaticAsset(path)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const page = isStaticPage(path), url = new URL(request.url);
  if (page) { url.pathname = "/index.html"; url.search = ""; }
  const response = await env.ASSETS.fetch(new Request(url, { method: request.method }));
  const secured = securityHeaders(request, response);
  secured.headers.set("Cache-Control", response.ok ? page ? "no-cache, must-revalidate" : path === "/styles.css" ? "public, max-age=86400" : "public, max-age=31536000, immutable" : "no-store");
  return secured;
}
