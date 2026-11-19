import { z } from "zod";
import { AgentApiError, AgentApiService } from "./agent-api";
import { grantVmInput } from "./agent-api-contracts";
import { ExeVmBackend } from "./exe-vm-backend";
import type { ExeConnection } from "./exe";
import { ConnectionRepository } from "./postgres/connection-repository";
import { databaseFor } from "./postgres/database";
import type { Env, OAuthProps } from "./types";
import { discoverVendorIssuerTrust, verifyVendorMachineIdentity } from "./vendor-run-identity";

export const VM_GRANT_HEADER = "X-Factorize-VM-Grant";
type Grant = {
  id: string;
  tenant_id: string;
  provider_id: string;
  vm: string;
  permissions: Record<string, number>;
  expires_at: Date;
  revoked_at: Date | null;
  issuer: string | null;
  subject: string | null;
  proof_hash: string | null;
};
const nameFor = (id: string) => "fzvm-" + id.replaceAll("-", "");
const audienceFor = (id: string) => "factorize://vm-grants/" + id;
const forbidden = () => new AgentApiError(403, "forbidden", "VM delegation is not authorized.");

async function backend(env: Env, row: Grant) {
  const db = databaseFor(env);
  const integration = (
    await db.pool.query(
      "SELECT credential_id FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2 AND kind='exe'",
      [row.tenant_id, row.provider_id],
    )
  ).rows[0];
  const connection =
    integration &&
    (await new ConnectionRepository(db, row.tenant_id, env.CREDENTIAL_ENCRYPTION_KEY).get<ExeConnection>(
      "exe:" + integration.credential_id,
    ));
  if (!connection) throw forbidden();
  return new ExeVmBackend(connection);
}

async function verify(
  row: Grant,
  token: string,
  attachment: { issuer: string; subject: string; audience: string; integrationName: string },
) {
  if (row.issuer && (row.issuer !== attachment.issuer || row.subject !== attachment.subject)) throw forbidden();
  const trust = await discoverVendorIssuerTrust({ provider: "exe.dev", issuer: attachment.issuer });
  await verifyVendorMachineIdentity({
    token,
    resolveKey: trust.resolveKey,
    binding: {
      provider: "exe.dev",
      vmId: row.vm,
      issuer: trust.issuer,
      audience: attachment.audience,
      subject: attachment.subject,
      exeAttachment: { integrationName: attachment.integrationName, attachedVmId: row.vm, mode: "vm" },
    },
  });
}

async function parent(env: Env, auth: OAuthProps) {
  if (auth.authMethod !== "oauth" || !auth.scopes.includes("vm:grant")) throw forbidden();
  const api = new AgentApiService(env, auth);
  return { api, id: (await api.identity()).id };
}

export async function grantVm(env: Env, auth: OAuthProps, value: unknown) {
  const input = grantVmInput.parse(value);
  if (!auth.scopes.includes("proxy:use")) throw forbidden();
  const { api, id } = await parent(env, auth);
  const provider = (await api.authorize(input.providerIntegrationId)).integration;
  if (provider.kind !== "exe")
    throw new AgentApiError(400, "unsupported_provider", "Only exe.dev connections support VM grants.");
  const permissions: Record<string, number> = {};
  for (const target of input.integrationIds) permissions[target] = (await api.authorize(target)).integration.epoch;
  const db = databaseFor(env);
  // Commit the identity before remote provisioning; a lost response must reuse the WIF name.
  const reserved = (
    await db.pool.query<Grant>(
      `INSERT INTO app.vm_grants(tenant_id,parent_id,provider_id,provider_epoch,vm,permissions,parent_scopes,request_key,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9)) ON CONFLICT(tenant_id,parent_id,request_key) DO UPDATE SET request_key=excluded.request_key
    RETURNING *`,
      [
        auth.tenantId,
        id,
        provider.id,
        provider.epoch,
        input.vm,
        JSON.stringify(permissions),
        JSON.stringify(auth.scopes),
        input.idempotencyKey,
        auth.oauthExpiresAt,
      ],
    )
  ).rows[0]!;
  if (
    reserved.provider_id !== provider.id ||
    reserved.vm !== input.vm ||
    Object.keys(reserved.permissions).length !== input.integrationIds.length ||
    input.integrationIds.some((key) => reserved.permissions[key] !== permissions[key])
  )
    throw new AgentApiError(409, "conflict", "This idempotency key belongs to a different grant.");
  if (env.SCHEDULER)
    await env.SCHEDULER.get(env.SCHEDULER.idFromName("global")).fetch("https://scheduler/wake", {
      method: "POST",
    });
  const grant = await db.transaction(async (tx) => {
    const row = (await tx.query<Grant>("SELECT * FROM app.vm_grants WHERE id=$1 FOR UPDATE", [reserved.id]))
      .rows[0]!;
    if (row.revoked_at || row.expires_at.getTime() <= Date.now()) throw forbidden();
    if (!row.issuer) {
      const exe = await backend(env, row),
        name = nameFor(row.id),
        audience = audienceFor(row.id);
      try {
        // On a retry an exact, exclusive WIF attachment may already exist.
        const attachment = await exe
          .identityIntegration(row.vm, name, audience, false)
          .catch(() => exe.identityIntegration(row.vm, name, audience, true));
        const guest = await exe.enrollGuest(row.vm, row.id, name);
        await verify(row, guest.token, attachment);
        await tx.query("UPDATE app.vm_grants SET issuer=$2,subject=$3,proof_hash=$4 WHERE id=$1", [
          row.id,
          attachment.issuer,
          attachment.subject,
          guest.proofHash,
        ]);
      } catch {
        throw new AgentApiError(
          502,
          "enrollment_failed",
          "Could not verify the exe.dev VM and its exclusive identity attachment.",
        );
      }
    }
    return row;
  });
  return {
    grantId: grant.id,
    vm: grant.vm,
    integrationIds: Object.keys(grant.permissions),
    expiresAt: grant.expires_at.toISOString(),
    tokenUrl: `https://${nameFor(grant.id)}.int.exe.xyz/token`,
    proofFile: `.factorize-vm-grants/${grant.id}`,
    requestUrl: env.APP_ORIGIN + "/api/v1/agent/requests",
    instructions:
      "From the guest, use tokenUrl's token as a bearer token. Send X-Factorize-VM-Grant: grantId and X-Factorize-VM-Proof: the trimmed contents of proofFile under the enrollment user's home directory.",
  };
}

export async function revokeVmGrant(env: Env, auth: OAuthProps, grantId: string) {
  const { id } = await parent(env, auth);
  const result = await databaseFor(env).pool.query(
    "UPDATE app.vm_grants SET revoked_at=coalesce(revoked_at,now()) WHERE tenant_id=$1 AND parent_id=$2 AND id=$3",
    [auth.tenantId, id, z.uuid().parse(grantId)],
  );
  if (!result.rowCount) throw new AgentApiError(404, "not_found", "VM grant not found.");
  return { grantId, revoked: true };
}

export async function authenticateVmGrant(env: Env, request: Request): Promise<OAuthProps | null> {
  const id = request.headers.get(VM_GRANT_HEADER),
    proof = request.headers.get("X-Factorize-VM-Proof");
  const token = request.headers.get("Authorization")?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!z.uuid().safeParse(id).success || !proof || !/^[a-f0-9]{64}$/.test(proof) || !token || token.length > 16384)
    return null;
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof + "\n"))).toString(
    "hex",
  );
  const row = (
    await databaseFor(env).pool.query<Grant & { user_id: string; session_version: number }>(
      `SELECT g.*,p.user_id,p.session_version FROM app.vm_grants g
    JOIN app.agent_identities p ON p.tenant_id=g.tenant_id AND p.id=g.parent_id
    WHERE g.id=$1 AND g.proof_hash=$2 AND g.revoked_at IS NULL AND p.revoked_at IS NULL AND g.expires_at>now()`,
      [id, hash],
    )
  ).rows[0];
  if (!row || !row.issuer) return null;
  try {
    const attachment = await (
      await backend(env, row)
    ).identityIntegration(row.vm, nameFor(row.id), audienceFor(row.id), false);
    await verify(row, token, attachment);
    return {
      authMethod: "vm_grant",
      tenantId: row.tenant_id,
      userId: row.user_id,
      sessionVersion: row.session_version,
      scopes: [],
      vmGrantId: row.id,
    };
  } catch {
    return null;
  }
}

export async function cleanupVmGrants(env: Env) {
  const db = databaseFor(env);
  // Claim a bounded batch. An unreachable provider cannot starve later grants;
  // a worker interrupted after a remote removal can safely retry it.
  const { rows } = await db.pool.query<Grant>(`UPDATE app.vm_grants SET cleanup_after=now()+interval '15 minutes'
    WHERE id IN (SELECT g.id FROM app.vm_grants g JOIN app.agent_identities p
      ON p.tenant_id=g.tenant_id AND p.id=g.parent_id
      WHERE g.cleaned_at IS NULL AND g.cleanup_after<=now() AND
      (g.revoked_at IS NOT NULL OR g.expires_at<=now() OR p.revoked_at IS NOT NULL)
      ORDER BY g.cleanup_after LIMIT 50 FOR UPDATE OF g SKIP LOCKED) RETURNING *`);
  for (const row of rows) {
    try {
      const exe = await backend(env, row);
      await exe.removeIdentityIntegration(
        row.vm,
        nameFor(row.id),
        audienceFor(row.id),
        row.issuer && row.subject ? { issuer: row.issuer, subject: row.subject } : undefined,
      );
      await db.pool.query("UPDATE app.vm_grants SET cleaned_at=now() WHERE id=$1", [row.id]);
    } catch {
      console.warn("VM grant identity cleanup pending", row.id);
    }
  }
}
