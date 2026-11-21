import {vmGrantProvider,type GrantMachineBinding} from "./vm-grant-providers";
import { z } from "zod";
import { AgentApiError, AgentApiService } from "./agent-api";
import { grantVmInput } from "./agent-api-contracts";
import { databaseFor } from "./postgres/database";
import type { Env, OAuthProps } from "./types";
import { discoverVendorIssuerTrust, verifyVendorMachineIdentity } from "./vendor-run-identity";

export const VM_GRANT_HEADER = "X-Factorize-VM-Grant";
type Grant = {
  id: string;
  tenant_id: string;
  provider_id: string;
  provider_epoch: number;
  vm: string;
  app: string | null;
  permissions: Record<string, number>;
  expires_at: Date;
  revoked_at: Date | null;
  issuer: string | null;
  subject: string | null;
  proof_hash: string | null;
};
const forbidden = () => new AgentApiError(403, "forbidden", "VM delegation is not authorized.");

async function verify(row:Grant,token:string,binding:GrantMachineBinding){
  if(row.issuer&&(row.issuer!==binding.issuer||row.subject!==binding.subject))throw forbidden();
  const trust=await discoverVendorIssuerTrust({provider:binding.provider,issuer:binding.issuer});
  await verifyVendorMachineIdentity({token,resolveKey:trust.resolveKey,binding:{...binding,issuer:trust.issuer}});
}

async function parent(env: Env, auth: OAuthProps) {
  if (auth.authMethod !== "oauth" || !auth.scopes.includes("vm:grant")) throw forbidden();
  const api = new AgentApiService(env, auth);
  const identity=await api.identity();
  if(identity.policy.disabled_scopes.includes("vm:grant"))throw forbidden();
  return { api, id: identity.id };
}

export async function grantVm(env: Env, auth: OAuthProps, value: unknown) {
  const input = grantVmInput.parse(value);
  if (!auth.scopes.includes("proxy:use")) throw forbidden();
  const { api, id } = await parent(env, auth);
  const provider = (await api.authorize(input.providerIntegrationId)).integration;
  if(provider.kind!=="exe"&&provider.kind!=="fly")throw new AgentApiError(400,"unsupported_provider","VM grants require an exe.dev or Fly.io connection.");
  if((provider.kind==="fly")!==Boolean(input.app))throw new AgentApiError(400,"invalid_request","Fly.io grants require app and Machine ID; exe.dev grants use only vm.");
  const permissions: Record<string, number> = {};
  for (const target of input.integrationIds) permissions[target] = (await api.authorize(target)).integration.epoch;
  const db = databaseFor(env);
  // Commit the identity before remote provisioning; a lost response must reuse the WIF name.
  const reserved = (
    await db.pool.query<Grant>(
      `INSERT INTO app.vm_grants(tenant_id,parent_id,provider_id,provider_epoch,vm,permissions,parent_scopes,request_key,app,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '1 hour') ON CONFLICT(tenant_id,parent_id,request_key) DO UPDATE SET request_key=excluded.request_key
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
        input.app??null,
      ],
    )
  ).rows[0]!;
  if (
    reserved.provider_id !== provider.id ||
    reserved.vm !== input.vm ||
    reserved.app !== (input.app??null) ||
    reserved.provider_epoch !== provider.epoch ||
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
      try {
        const guest=await (await vmGrantProvider(env,row)).enroll();
        await verify(row,guest.token,guest.binding);
        await tx.query("UPDATE app.vm_grants SET issuer=$2,subject=$3,proof_hash=$4 WHERE id=$1", [
          row.id,
          guest.binding.issuer,
          guest.binding.subject,
          guest.proofHash,
        ]);
      } catch {
        throw new AgentApiError(
          502,
          "enrollment_failed",
          "Could not verify the VM and its provider-signed identity.",
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
    ...(await vmGrantProvider(env,grant)).receipt,
    requestUrl: env.APP_ORIGIN + "/api/v1/agent/requests",
    readResponseUrl: env.APP_ORIGIN + "/api/v1/agent/responses/read",
  };
}

/** Renew only a live lease owned by this same OAuth authorization. Refreshing
 * a client token never touches leases; every extension rechecks delegation. */
export async function renewVmGrant(env: Env, auth: OAuthProps, grantId: string) {
  if (!auth.scopes.includes("proxy:use")) throw forbidden();
  const {api,id}=await parent(env,auth),db=databaseFor(env);
  return db.transaction(async tx=>{
    const row=(await tx.query<Grant>(`SELECT * FROM app.vm_grants WHERE tenant_id=$1 AND parent_id=$2 AND id=$3
      AND revoked_at IS NULL AND cleaned_at IS NULL AND issuer IS NOT NULL AND expires_at>now() FOR UPDATE`,
      [auth.tenantId,id,z.uuid().parse(grantId)])).rows[0];
    if(!row)throw new AgentApiError(404,"not_found","An active VM grant owned by this authorization was not found. Create a new grant after expiry.");
    const provider=(await api.authorize(row.provider_id)).integration;
    if(provider.epoch!==row.provider_epoch)throw forbidden();
    for(const [integration,epoch] of Object.entries(row.permissions)){
      if((await api.authorize(integration)).integration.epoch!==epoch)throw forbidden();
    }
    const renewed=(await tx.query<{expires_at:Date}>(`UPDATE app.vm_grants SET expires_at=now()+interval '1 hour',parent_scopes=$4
      WHERE tenant_id=$1 AND parent_id=$2 AND id=$3 AND expires_at>now() AND revoked_at IS NULL RETURNING expires_at`,
      [auth.tenantId,id,row.id,JSON.stringify(auth.scopes)])).rows[0];
    if(!renewed)throw forbidden();
    return {grantId:row.id,expiresAt:renewed.expires_at.toISOString()};
  });
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
    const binding=await (await vmGrantProvider(env,row)).inspect();
    await verify(row,token,binding);
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
      // Fly has no per-grant provider attachment, even after disconnection.
      if(!row.app)await (await vmGrantProvider(env,row)).cleanup();
      await db.pool.query("UPDATE app.vm_grants SET cleaned_at=now() WHERE id=$1", [row.id]);
    } catch {
      console.warn("VM grant identity cleanup pending", row.id);
    }
  }
}
