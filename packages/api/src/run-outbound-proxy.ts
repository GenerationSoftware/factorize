import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { EncryptedIntegrationRepository } from "./postgres/encrypted-integration-repository";
import { resolveRunProviderCredentials } from "./provider-credentials";
import { authenticateVendorRunRequest, RUN_IDENTITY_HEADER } from "./vendor-run-auth";
import { forwardRunOutbound, type OutboundCredential } from "./run-outbound-forwarder";
import { resolveManagedModelCredential } from "./managed-model-credentials";
import { isPublicHttpsOrigin } from "./public-address";

const unavailable = () => new Response("Run credential unavailable", {status: 403, headers: {"Cache-Control": "no-store"}});

/** Raw outbound protocol boundary. The guest supplies a path, never an origin,
 * upstream token, tenant, or credential outside its immutable run selection. */
export async function runOutboundProxyFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = /^\/internal\/run-proxy\/([0-9a-f-]{36})(\/.*)$/.exec(url.pathname);
  if (!route || route[1] !== request.headers.get(RUN_IDENTITY_HEADER)) return unavailable();
  const auth = await authenticateVendorRunRequest(request, env);
  if (!auth?.runId || auth.authMethod !== "vendor_identity") return unavailable();
  const database = databaseFor(env);
  const active = async () => (await database.pool.query<{ execution_config: Record<string, unknown> }>(`SELECT r.execution_config FROM app.runs r JOIN app.job_runs j ON j.tenant_id=r.tenant_id AND j.id=r.id
    JOIN app.vendor_run_identity_bindings b ON b.tenant_id=j.tenant_id AND b.run_id=j.id
    WHERE r.tenant_id=$1 AND r.id=$2 AND b.provider=$3 AND b.revoked_at IS NULL
      AND r.state IN ('starting','running','blocked') AND j.state IN ('starting','running','blocked')`, [auth.tenantId, auth.runId, auth.runIdentityProvider])).rows[0];
  const revoked = async (kind: string, id: string) => Boolean((await database.pool.query(
    "SELECT 1 FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2 AND kind=$3 AND credential_id=$4", [auth.tenantId, auth.runId, kind, id])).rowCount);
  const run = await active();
  if (!run) return unavailable();
  const config = run.execution_config, path = route[2]!;
  let selected: OutboundCredential | null = null;
  try {
    const bearer = /^\/integrations\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
    const github = /^\/providers\/github\/([1-9][0-9]*)(\/.*)?$/.exec(path);
    const linear = /^\/providers\/linear(\/.*)?$/.exec(path);
    const model = /^\/providers\/model\/v1(\/.*)?$/.exec(path);
    if (bearer) {
      if (!Array.isArray(config.portableIntegrationIds) || !config.portableIntegrationIds.includes(bearer[1]) || await revoked("bearer", bearer[1]!)) return unavailable();
      const credential = await new EncryptedIntegrationRepository(database, auth.tenantId, env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(bearer[1]!, "bearer");
      if (!credential?.origin || !isPublicHttpsOrigin(credential.origin, env.APP_ORIGIN)) return unavailable();
      selected = {origin: credential.origin, path: `${bearer[2] ?? "/"}${url.search}`, credential: credential.payload};
    } else if (github) {
      const installationId = Number(github[1]);
      if (!Number.isSafeInteger(installationId) || !Array.isArray(config.githubInstallationIds) || !config.githubInstallationIds.includes(installationId) || await revoked("github", github[1]!)) return unavailable();
      const resolved = await resolveRunProviderCredentials({database, env, tenantId: auth.tenantId, githubInstallationIds: [installationId], linearSelected: false});
      const credential = resolved.githubInstallations[0];
      if (!credential?.available || !credential.accessToken) return unavailable();
      let suffix = github[2] ?? "/", origin = "https://api.github.com";
      const smart = /\/(?:info\/refs|git-upload-pack|git-receive-pack)$/.test(suffix);
      if (smart) origin = "https://github.com";
      else if (suffix.startsWith("/raw/")) { origin = "https://raw.githubusercontent.com"; suffix = suffix.slice(4); }
      else if (suffix.startsWith("/archive/")) { origin = "https://codeload.github.com"; suffix = suffix.slice(8); }
      selected = {origin, path: `${suffix}${url.search}`, credential: credential.accessToken, authorization: smart ? "github-git-basic" : "bearer"};
    } else if (linear) {
      if (config.linearConnectionId !== "linear" || await revoked("linear", "linear")) return unavailable();
      const resolved = await resolveRunProviderCredentials({database, env, tenantId: auth.tenantId, githubInstallationIds: [], linearSelected: true});
      if (!resolved.linearConnection?.available || !resolved.linearConnection.accessToken) return unavailable();
      selected = {origin: "https://api.linear.app", path: `${linear[1] ?? "/graphql"}${url.search}`, credential: resolved.linearConnection.accessToken};
    } else if (model) {
      if (config.modelAccess !== "portable" || typeof config.modelAccountId !== "string" || await revoked("model", config.modelAccountId)) return unavailable();
      const credential = await resolveManagedModelCredential({database, env, tenantId: auth.tenantId, accountId: config.modelAccountId});
      if (!credential) return unavailable();
      const suffix = model[1] ?? "/";
      const target = new URL(`${credential.origin}${credential.prefix}${suffix}`);
      if (!target.pathname.startsWith(`${credential.prefix}/`)) return unavailable();
      selected = {origin: credential.origin, path: `${target.pathname}${url.search}`, credential: credential.accessToken,
        ...(credential.accountId ? {headers: {"chatgpt-account-id": credential.accountId}} : {})};
    }
    if (!selected || !await active()) return unavailable();
    return await forwardRunOutbound(request, selected);
  } catch {
    return new Response("Run outbound request unavailable", {status: 502, headers: {"Cache-Control": "no-store"}});
  }
}
