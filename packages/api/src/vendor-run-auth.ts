import type { Env, OAuthProps } from "./types";
import { databaseFor } from "./postgres/database";
import { ConnectionRepository } from "./postgres/connection-repository";
import { FlyConnectionRepository } from "./postgres/fly-connection-repository";
import { ExeVmBackend, vmNameFor } from "./exe-vm-backend";
import type { ExeRunConnection } from "./exe";
import { normalizeScopes } from "./access-tokens";
import { discoverVendorIssuerTrust, verifyVendorRunIdentity, type VendorIdentityProvider } from "./vendor-run-identity";

export const RUN_IDENTITY_HEADER = "X-Factorize-Run-Id";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RunAuthorization = {
  tenant_id: string; run_id: string; trigger_id: string | null; user_id: string; session_version: number;
  scopes: string[]; provider: VendorIdentityProvider; vm_id: string; issuer: string;
  subject: string; audience: string; execution_config: Record<string, unknown>;
  execution_handle: { id?: string; vendorIdentityIntegrationName?: string } | null;
};

/** A run ID is a lookup hint, never authority. Only a fresh vendor signature
 * matching the immutable provisioned binding can authorize this request. */
export async function authenticateVendorRunRequest(request: Request, env: Env, options: {artifactFinalization?: boolean} = {}): Promise<OAuthProps | null> {
  const runId = request.headers.get(RUN_IDENTITY_HEADER);
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
  if (!runId || !uuid.test(runId) || !token || token.length > 16_384) return null;
  const database = databaseFor(env);
  // Stopping guests may finish a separately signed artifact upload only.
  // Application/proxy callers never enable this control-protocol mode.
  const states = options.artifactFinalization ? "('starting','running','blocked','stopping')" : "('starting','running','blocked')";
  const result = await database.pool.query<RunAuthorization>(`SELECT b.tenant_id,b.run_id,b.provider,b.vm_id,b.issuer,b.subject,b.audience,
      c.user_id,c.session_version,c.scopes,j.trigger_id,r.execution_config,r.execution_handle
    FROM app.vendor_run_identity_bindings b
    JOIN app.trigger_runs j ON j.tenant_id=b.tenant_id AND j.id=b.run_id
    JOIN app.runs r ON r.tenant_id=j.tenant_id AND r.id=j.id
    JOIN app.run_authorizations c ON c.tenant_id=j.tenant_id AND c.run_id=j.id
    JOIN app.members m ON m.tenant_id=c.tenant_id AND m.user_id=c.user_id AND m.role='owner' AND m.session_version=c.session_version
    WHERE b.run_id=$1 AND b.revoked_at IS NULL AND j.state IN ${states}
      AND r.state IN ${states}`, [runId]);
  // Fail closed on ambiguous cross-tenant/run/provider lookup as well as absence.
  if (result.rows.length !== 1) return null;
  const row = result.rows[0]!;
  try {
    let exeAttachment: { integrationName: string; attachedVmId: string; mode: "vm" } | undefined;
    if (row.provider === "exe.dev") {
      if (row.vm_id !== vmNameFor(runId) || row.execution_handle?.id !== row.vm_id) return null;
      const connectionId = row.execution_config.connectionId;
      if (typeof connectionId !== "string") return null;
      const connection = await new ConnectionRepository(database, row.tenant_id, env.CREDENTIAL_ENCRYPTION_KEY).get<ExeRunConnection>(`exe:${connectionId}`);
      if (!connection) return null;
      // Re-read provider inventory on every admission. A valid integration JWT
      // alone is insufficient if someone broadened or moved its attachment.
      const attachment = await new ExeVmBackend(connection).verifyIdentityAttachment(row.vm_id, runId);
      if (attachment.issuer !== row.issuer || attachment.subject !== row.subject || attachment.audience !== row.audience) return null;
      exeAttachment = { integrationName: attachment.integrationName, attachedVmId: row.vm_id, mode: "vm" };
    } else if (row.provider === "fly.io") {
      const connection = await new FlyConnectionRepository(database, row.tenant_id, env.CREDENTIAL_ENCRYPTION_KEY).get();
      const parts = row.execution_handle?.id?.split("/");
      if (!connection || !parts || parts.length !== 2 || parts[1] !== row.vm_id
          || row.issuer !== `https://oidc.fly.io/${connection.organizationSlug}`
          || !row.subject.startsWith(`${connection.organizationSlug}:${parts[0]}:`)) return null;
    } else return null;
    const trust = await discoverVendorIssuerTrust({ provider: row.provider, issuer: row.issuer });
    await verifyVendorRunIdentity({ token, resolveKey: trust.resolveKey, binding: {
      provider: row.provider, runId, activeRunId: row.run_id, vmId: row.vm_id,
      issuer: row.issuer, subject: row.subject, audience: row.audience, exeAttachment,
    } });
    return { tenantId: row.tenant_id, userId: row.user_id, sessionVersion: row.session_version,
      scopes: normalizeScopes(row.scopes), authMethod: "vendor_identity", runId, runTriggerId: row.trigger_id ?? undefined,
      runIdentityProvider: row.provider };
  } catch {
    // Never surface provider response text, JWTs, or decrypted credentials.
    return null;
  }
}
