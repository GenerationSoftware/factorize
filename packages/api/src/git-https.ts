import { Buffer } from "node:buffer";
import { databaseFor } from "./postgres/database";
import { AgentApiError } from "./agent-api-error";
import { repositoryToken } from "./skill-content";
import { SkillLibrary } from "./skill-library";
import { installationToken, githubHeaders } from "./github";
import type { Env, OAuthProps } from "./types";

async function namespace(env: Env, tenantId: string) {
  return databaseFor(env).transaction(async client => {
    // Stable names survive renames; serialize allocation to give collisions readable suffixes.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('skill-git-namespaces',0))");
    const existing = await client.query("SELECT slug FROM app.skill_git_namespaces WHERE tenant_id=$1", [tenantId]);
    if (existing.rows[0]) return existing.rows[0].slug as string;
    const team = await client.query("SELECT t.name,u.username FROM app.tenants t LEFT JOIN app.auth_users u ON u.id=t.personal_owner_id WHERE t.id=$1", [tenantId]);
    const base = String(team.rows[0]?.name || team.rows[0]?.username || "team").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "") || "team";
    for (let suffix = 1; suffix <= 10000; suffix++) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      if ((await client.query("INSERT INTO app.skill_git_namespaces(tenant_id,slug) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING slug", [tenantId, slug])).rowCount) return slug;
    }
    throw new AgentApiError(409, "namespace_unavailable", "A Git repository name could not be allocated.");
  });
}
export async function skillCloneInfo(env: Env, tenantId: string) {
  const { source } = await new SkillLibrary(env, tenantId).status();
  const base = { source: source?.kind ?? null, url: null as string | null, writable: false, branch: "main", folder: "skills" };
  if (!source) return base;
  if (source.kind === "github") {
    const installation = await databaseFor(env).pool.query("SELECT 1 FROM app.github_installations WHERE tenant_id=$1 AND installation_id=$2 AND state='active'", [tenantId, source.installationId]);
    if (!installation.rowCount) throw new AgentApiError(409, "github_unavailable", "Reconnect the GitHub installation to clone this repository.");
    const token = await installationToken(env, source.installationId, source.repositoryId);
    const response = await fetch(`https://api.github.com/repositories/${source.repositoryId}`, { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new AgentApiError(502, "github_unavailable", "The GitHub repository could not be loaded.");
    const repo = await response.json() as { full_name?: string };
    if (!repo.full_name || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.full_name)) throw new AgentApiError(502, "github_unavailable", "Invalid GitHub repository name.");
    return { ...base, url: `https://github.com/${repo.full_name}.git`, branch: source.branch, folder: source.folder };
  }
  return { ...base, url: `https://git.factorize.sh/${await namespace(env, tenantId)}/skills.git`, writable: true };
}
const digest = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
export async function issueGitCredential(env: Env, auth: OAuthProps) {
  await new SkillLibrary(env, auth.tenantId).status();
  const db = databaseFor(env);
  return db.transaction(async client => {
    const library = await client.query("SELECT repo FROM app.skill_libraries WHERE tenant_id=$1 AND source->>'kind'='managed' FOR SHARE", [auth.tenantId]);
    if (!library.rows[0]) throw new AgentApiError(409, "github_source", "Use your own GitHub credentials for GitHub repositories.");
    const token = `fgit_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 3600_000);
    await client.query("DELETE FROM app.skill_git_tokens WHERE expires_at < now()");
    await client.query("INSERT INTO app.skill_git_tokens(digest,tenant_id,user_id,repo,session_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)", [await digest(token), auth.tenantId, auth.userId, library.rows[0].repo, auth.sessionVersion, expiresAt]);
    return { username: "git" as const, token, expiresAt: expiresAt.toISOString() };
  });
}
function credential(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (!header.startsWith("Basic ")) return null;
  try { const decoded = atob(header.slice(6)); const colon = decoded.indexOf(":"); return colon > 0 ? decoded.slice(colon + 1) : null; } catch { return null; }
}
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
/** Git smart-HTTP protocol, never an application JSON endpoint. */
export async function gitHttpsFetch(request: Request, env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/skills\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
  if (!match) return new Response("Not found", { status: 404, headers: noStore });
  const service = match[2] === "info/refs" ? url.searchParams.get("service") : match[2];
  if (!["git-upload-pack", "git-receive-pack"].includes(service ?? "") || (match[2] === "info/refs" ? request.method !== "GET" : request.method !== "POST")) return new Response("Invalid Git operation", { status: 400, headers: noStore });
  if (request.method === "POST" && request.headers.get("Content-Type")?.split(";")[0] !== `application/x-${service}-request`) return new Response("Invalid Git content type", { status: 415, headers: noStore });
  const token = credential(request);
  const unauthorized = () => new Response("Use a Factorize Git token as your password. Get one from the Skills Code menu.", { status: 401, headers: { ...noStore, "WWW-Authenticate": 'Basic realm="Factorize Git", charset="UTF-8"' } });
  if (!token || !/^fgit_[A-Za-z0-9_-]{43}$/.test(token)) return unauthorized();
  const row = (await databaseFor(env).pool.query(
    `SELECT l.tenant_id,l.repo,l.remote FROM app.skill_git_tokens k
     JOIN app.skill_git_namespaces n ON n.tenant_id=k.tenant_id
     JOIN app.skill_libraries l ON l.tenant_id=k.tenant_id AND l.repo=k.repo
     JOIN app.members m ON m.tenant_id=k.tenant_id AND m.user_id=k.user_id AND m.session_version=k.session_version
     JOIN app.auth_users u ON u.id=k.user_id
     WHERE k.digest=$1 AND k.expires_at>now() AND n.slug=$2 AND m.role='owner' AND u.email_verified AND l.source->>'kind'='managed'`, [await digest(token), match[1]],
  )).rows[0];
  if (!row || !env.SKILL_ARTIFACTS) return unauthorized();
  const maxBytes = 16 * 1024 * 1024;
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) return new Response("Git request exceeds 16 MiB", { status: 413, headers: noStore });
  const remote = new URL(row.remote);
  if (remote.protocol !== "https:" || remote.username || remote.password || remote.search || remote.hash) return new Response("Git repository unavailable", { status: 503, headers: noStore });
  remote.pathname = remote.pathname.replace(/\/$/, "") + "/" + match[2];
  if (match[2] === "info/refs") remote.searchParams.set("service", service!);
  const upstream = await repositoryToken(env.SKILL_ARTIFACTS, row.repo, service === "git-receive-pack" ? "write" : "read");
  const headers = new Headers({ Authorization: `Bearer ${upstream.plaintext}`, "Accept-Encoding": "identity" });
  for (const name of ["Content-Type", "Accept", "Git-Protocol", "User-Agent"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  let bytes = 0;
  const body = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > maxBytes) throw new Error("Git request exceeds 16 MiB"); controller.enqueue(chunk); } }));
  let response: Response;
  try { response = await fetch(remote, { method: request.method, headers, body, redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) }); }
  catch { return new Response("Git service unavailable; retry the operation", { status: 502, headers: noStore }); }
  if (!response.ok) { await response.body?.cancel(); return new Response("Git upstream rejected the operation", { status: 502, headers: noStore }); }
  // Push events also publish through SkillPushWorkflow; this refresh reduces UI delay.
  if (service === "git-receive-pack" && request.method === "POST") ctx.waitUntil(new SkillLibrary(env, row.tenant_id).sync({ repo: row.repo }).catch(() => { console.error("Git push publication will retry through the push workflow"); }));
  return new Response(response.body, { status: response.status, headers: { ...noStore, "Content-Type": response.headers.get("Content-Type") ?? `application/x-${service}-result` } });
}
