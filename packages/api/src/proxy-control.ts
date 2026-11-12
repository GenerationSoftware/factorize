import { databaseFor } from "./postgres/database";
import { ProxyControlRepository } from "./postgres/proxy-control-repository";
import { RunEnrollmentRepository } from "./postgres/run-enrollment-repository";
import { EncryptedIntegrationRepository } from "./postgres/encrypted-integration-repository";
import { authenticateRunCredential } from "./run-credentials";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Dedicated service-to-service endpoint. The run API credential is intentionally not accepted here. */
export async function proxyControlFetch(request: Request, env: Parameters<typeof databaseFor>[0]): Promise<Response> {
  const url = new URL(request.url);
  if (!["/internal/credential-proxy/register-boot", "/internal/credential-proxy/enroll", "/internal/credential-proxy/consume-enrollment", "/internal/credential-proxy/integration-snapshot", "/internal/credential-proxy/model-account-cache", "/internal/credential-proxy/revocations"].includes(url.pathname)) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "unsupported_media_type" }, 415);
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  const maxBodyBytes = url.pathname === "/internal/credential-proxy/model-account-cache" ? 70_000 : 1024;
  if (declaredLength > maxBodyBytes) return json({ error: "invalid_request" }, 413);
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) { await reader.cancel(); return json({ error: "invalid_request" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: "invalid_request" }, 400); }
  const repository = new ProxyControlRepository(databaseFor(env));
  if (url.pathname === "/internal/credential-proxy/register-boot") {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "bootEpoch,browserOrigin" || typeof (body as any).bootEpoch !== "string" || typeof (body as any).browserOrigin !== "string") return json({ error: "invalid_request" }, 400);
    const registration = await repository.registerBoot(token, (body as any).bootEpoch, (body as any).browserOrigin);
    if (!registration) return json({ error: "proxy_registration_unavailable" }, 403);
    return json({ registered: true, tenantId: registration.tenantId, proxyIdentity: registration.proxyIdentity, bootEpoch: registration.bootEpoch, controlCredential: registration.controlCredential });
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
  if (url.pathname === "/internal/credential-proxy/model-account-cache") {
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400);
    const input = body as Record<string, unknown>;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (input.operation === "list" && Object.keys(input).length === 1) {
      const accounts = await new EncryptedIntegrationRepository(databaseFor(env), proxy.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).records("model");
      const keyState = await databaseFor(env).pool.query<{ generation_id: string }>("SELECT generation_id FROM app.unlock_key_verifications WHERE tenant_id=$1", [proxy.tenantId]);
      if (!keyState.rows[0]) return json({ error: "model_account_unavailable" }, 404);
      return json({ ownerId: proxy.tenantId, keyGeneration: keyState.rows[0].generation_id,
        accounts: accounts.map(({ id, revision }) => ({ id, revision, kind: "model", origin: null })) });
    }
    if (input.operation === "read" && Object.keys(input).sort().join(",") === "accountId,operation"
        && typeof input.accountId === "string" && uuid.test(input.accountId)) {
      const account = (await new EncryptedIntegrationRepository(databaseFor(env), proxy.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).records("model"))
        .find(record => record.id === input.accountId);
      if (!account) return json({ error: "model_account_unavailable" }, 404);
      const keyState = await databaseFor(env).pool.query<{ generation_id: string }>("SELECT generation_id FROM app.unlock_key_verifications WHERE tenant_id=$1", [proxy.tenantId]);
      if (!keyState.rows[0]) return json({ error: "model_account_unavailable" }, 404);
      return json({ ownerId: proxy.tenantId, account: { ...account, keyGeneration: keyState.rows[0].generation_id } });
    }
    if (input.operation !== "save" || Object.keys(input).sort().join(",") !== "accountId,encryptedPayload,expectedRevision,idempotencyKey,operation"
        || typeof input.accountId !== "string" || !uuid.test(input.accountId)
        || typeof input.idempotencyKey !== "string" || !uuid.test(input.idempotencyKey)
        || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0
        || typeof input.encryptedPayload !== "string") return json({ error: "invalid_request" }, 400);
    try {
      const saved = await new EncryptedIntegrationRepository(databaseFor(env), proxy.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).saveModelCache({
        id: input.accountId, expectedRevision: input.expectedRevision as number,
        idempotencyKey: input.idempotencyKey, encryptedPayload: input.encryptedPayload,
      });
      return json({ ...saved, accountId: input.accountId });
    } catch (error) {
      if (error instanceof Error && error.name === "StaleIntegrationRevisionError") return json({ error: "stale_revision" }, 409);
      if (error instanceof Error && error.name === "IntegrationIdempotencyConflictError") return json({ error: "idempotency_conflict" }, 409);
      if (error instanceof Error && error.name === "IntegrationValidationError") return json({ error: "model_account_unavailable" }, 404);
      throw error;
    }
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
    const modelAccess = run.execution_config?.modelAccess ?? "native";
    const modelAccountId = run.execution_config?.modelAccountId;
    let modelAccount = null;
    if (modelAccess === "portable") {
      if (typeof modelAccountId !== "string") return json({ error: "integration_snapshot_unavailable" }, 403);
      modelAccount = (await new EncryptedIntegrationRepository(database, proxy.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).records("model"))
        .find(record => record.id === modelAccountId) ?? null;
      if (!modelAccount) return json({ error: "integration_snapshot_unavailable" }, 403);
    } else if (modelAccess !== "native" || modelAccountId !== undefined) {
      return json({ error: "integration_snapshot_unavailable" }, 403);
    }
    // Only the selected model account's user-encrypted payload crosses the
    // control plane. It remains encrypted until the proxy is unlocked.
    return json({ ownerId: proxy.tenantId, records, modelAccount });
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
