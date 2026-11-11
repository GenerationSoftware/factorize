import { databaseFor } from "./postgres/database";
import { ProxyControlRepository } from "./postgres/proxy-control-repository";
import { RunEnrollmentRepository } from "./postgres/run-enrollment-repository";
import { EncryptedIntegrationRepository } from "./postgres/encrypted-integration-repository";
import { authenticateRunCredential } from "./run-credentials";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Dedicated service-to-service endpoint. The run API credential is intentionally not accepted here. */
export async function proxyControlFetch(request: Request, env: Parameters<typeof databaseFor>[0]): Promise<Response> {
  const url = new URL(request.url);
  if (!["/internal/credential-proxy/register-boot", "/internal/credential-proxy/enroll", "/internal/credential-proxy/consume-enrollment", "/internal/credential-proxy/integration-snapshot", "/internal/credential-proxy/revocations"].includes(url.pathname)) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "unsupported_media_type" }, 415);
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 1024) return json({ error: "invalid_request" }, 413);
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); return json({ error: "invalid_request" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: "invalid_request" }, 400); }
  const repository = new ProxyControlRepository(databaseFor(env));
  if (url.pathname === "/internal/credential-proxy/register-boot") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "bootEpoch") || typeof (body as any).bootEpoch !== "string") return json({ error: "invalid_request" }, 400);
    const registration = await repository.registerBoot(token, (body as any).bootEpoch);
    if (!registration) return json({ error: "proxy_registration_unavailable" }, 403);
    return json({ registered: true, proxyIdentity: registration.proxyIdentity, bootEpoch: registration.bootEpoch, controlCredential: registration.controlCredential });
  }

  const proxy = await repository.authenticateProxy(token);
  if (!proxy) return json({ error: "unauthorized" }, 401);
  if (url.pathname === "/internal/credential-proxy/revocations") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "bootEpoch")
        || typeof (body as any).bootEpoch !== "string" || (body as any).bootEpoch !== proxy.bootEpoch) return json({ error: "invalid_request" }, 400);
    const revoked = await databaseFor(env).pool.query<{ run_id: string }>(`SELECT run_id FROM app.credential_run_grants
      WHERE tenant_id=$1 AND proxy_identity=$2 AND boot_epoch=$3 AND revoked_at IS NOT NULL ORDER BY revoked_at,run_id`,
    [proxy.tenantId, proxy.proxyIdentity, proxy.bootEpoch]);
    return json({ revokedRunIds: revoked.rows.map(row => row.run_id) });
  }
  if (url.pathname === "/internal/credential-proxy/integration-snapshot") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["runId", "grantRevision"].includes(key))
        || typeof (body as any).runId !== "string" || !Number.isSafeInteger((body as any).grantRevision) || (body as any).grantRevision < 0) return json({ error: "invalid_request" }, 400);
    const database = databaseFor(env);
    const active = await database.pool.query<{ execution_config: Record<string, unknown>; grant_revision: string | number }>(`SELECT r.execution_config,g.grant_revision
      FROM app.runs r JOIN app.credential_run_grants g ON g.tenant_id=r.tenant_id AND g.run_id=r.id
      JOIN app.credential_proxy_states p ON p.tenant_id=g.tenant_id AND p.proxy_identity=g.proxy_identity AND p.boot_epoch=g.boot_epoch
      WHERE r.tenant_id=$1 AND r.id=$2 AND r.state IN ('starting','running','blocked')
        AND g.proxy_identity=$3 AND g.boot_epoch=$4 AND g.grant_revision=$5 AND g.revoked_at IS NULL
        AND p.disabled_at IS NULL AND p.revoked_at IS NULL`, [proxy.tenantId, (body as any).runId, proxy.proxyIdentity, proxy.bootEpoch, (body as any).grantRevision]);
    const run = active.rows[0];
    if (!run) return json({ error: "integration_snapshot_unavailable" }, 403);
    const selected = run.execution_config?.portableIntegrationIds;
    if (!Array.isArray(selected) || selected.some(id => typeof id !== "string") || new Set(selected).size !== selected.length) return json({ error: "integration_snapshot_unavailable" }, 403);
    const records = selected.length
      ? (await new EncryptedIntegrationRepository(database, proxy.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).records("bearer"))
        .filter(record => selected.includes(record.id))
      : [];
    if (records.length !== selected.length) return json({ error: "integration_snapshot_unavailable" }, 403);
    return json({ ownerId: proxy.tenantId, records });
  }
  const enrollments = new RunEnrollmentRepository(databaseFor(env));
  if (url.pathname === "/internal/credential-proxy/enroll") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["runId", "vmIdentity", "runCredential"].includes(key))
      || typeof (body as any).runId !== "string" || typeof (body as any).vmIdentity !== "string" || typeof (body as any).runCredential !== "string"
      || (body as any).vmIdentity.length === 0 || (body as any).vmIdentity.length > 255) return json({ error: "invalid_request" }, 400);
    // A proxy-authenticated request alone must not let a peer that can reach
    // the proxy claim another active run. The VM's distinct run credential is
    // validated against the current run and tenant before issuing enrollment.
    const runAuth = await authenticateRunCredential(new Request(request.url, {
      headers: { Authorization: `Bearer ${(body as any).runCredential}` },
    }), env);
    if (!runAuth || !runAuth.runId || runAuth.runId !== (body as any).runId || runAuth.tenantId !== proxy.tenantId
        || !runAuth.scopes.includes("integrations:read")) return json({ error: "enrollment_unavailable" }, 403);
    const enrollment = await enrollments.issue({ tenantId: proxy.tenantId, runId: runAuth.runId, vmIdentity: (body as any).vmIdentity, proxyIdentity: proxy.proxyIdentity, bootEpoch: proxy.bootEpoch }, new Date(Date.now() + 30_000));
    return enrollment ? json(enrollment) : json({ error: "enrollment_unavailable" }, 403);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["runId", "vmIdentity", "enrollmentToken"].includes(key))
    || typeof (body as any).runId !== "string" || typeof (body as any).vmIdentity !== "string" || typeof (body as any).enrollmentToken !== "string") return json({ error: "invalid_request" }, 400);
  const binding = { tenantId: proxy.tenantId, runId: (body as any).runId, vmIdentity: (body as any).vmIdentity, proxyIdentity: proxy.proxyIdentity, bootEpoch: proxy.bootEpoch };
  const consumed = await enrollments.consume((body as any).enrollmentToken, binding);
  return consumed ? json({ consumed: true, binding: consumed }) : json({ error: "enrollment_unavailable" }, 403);
}
