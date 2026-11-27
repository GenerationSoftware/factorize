import { z } from "zod";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import type { VmGrant } from "./postgres/vm-grant-repository";
import type { Env, OAuthProps } from "./types";
import { flyVmGrantProvider, requireVmGrantProvider } from "./vm-grant-provider";
import { currentVmScopes } from "./vm-permissions";

export const VM_GRANT_HEADER = "X-Factorize-VM-Grant";
export const VM_PROOF_HEADER = "X-Factorize-VM-Proof";
const proofLifetime = 60;
const futureSkew = 10;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf8", { fatal: true });
const jwtPart = /^[A-Za-z0-9_-]+$/;
const uuid = z.uuid();
const proofHeader = z.strictObject({ alg: z.literal("ES256"), typ: z.literal("factorize-vm-proof+jwt") });
const proofClaims = z.strictObject({
  grant: uuid,
  ath: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  htm: z.string(),
  htu: z.string(),
  jti: uuid,
  iat: z.number().int(),
});

function decode(value: string) {
  if (!jwtPart.test(value)) throw new Error("Invalid proof encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), byte => byte.charCodeAt(0));
}

async function verifyProof(request: Request, token: string, proof: string, grant: VmGrant, now: number) {
  const parts = proof.split(".");
  if (parts.length !== 3 || !grant.public_key) throw new Error("Invalid VM proof");
  proofHeader.parse(JSON.parse(decoder.decode(decode(parts[0]!))));
  const claims = proofClaims.parse(JSON.parse(decoder.decode(decode(parts[1]!))));
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  const ath = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (claims.grant !== grant.id || claims.ath !== ath || claims.htm !== request.method || claims.htu !== request.url ||
      claims.iat > now + futureSkew || claims.iat + proofLifetime <= now) throw new Error("VM proof mismatch");
  const key = await crypto.subtle.importKey("jwk", grant.public_key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signature = decode(parts[2]!);
  if (signature.byteLength !== 64 || !await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, signature, encoder.encode(parts[0]! + "." + parts[1]!),
  )) throw new Error("Invalid VM proof signature");
  return claims;
}

async function activeGrant(db: DatabaseClient, id: string, tenantId?: string, lock = false) {
  return (await db.query<VmGrant>(
    `SELECT g.* FROM app.vm_permission_grants g
     JOIN app.agent_integrations p ON p.tenant_id=g.tenant_id AND p.id=g.provider_id AND p.kind=g.provider_kind
     WHERE g.id=$1 AND ($2::uuid IS NULL OR g.tenant_id=$2) AND g.activated_at IS NOT NULL AND g.revoked_at IS NULL
       AND p.available AND p.epoch=g.provider_epoch${lock ? " FOR SHARE OF g, p" : ""}`,
    [id, tenantId ?? null],
  )).rows[0];
}

export async function activeVmAuthorization(env: Env, auth: OAuthProps): Promise<string[] | null> {
  if (auth.authMethod !== "vm" || !auth.vmGrantId || !auth.vmTokenExpiresAt || auth.vmTokenExpiresAt <= Date.now() / 1000) return null;
  const db = databaseFor(env);
  const grant = await activeGrant(db.pool, auth.vmGrantId, auth.tenantId);
  if (!grant) return null;
  try { requireVmGrantProvider(grant.provider_kind); }
  catch { return null; }
  return currentVmScopes(db.pool, auth.tenantId, grant.scopes.filter(scope => auth.scopes.includes(scope)));
}

export async function authenticateVmRequest(env: Env, request: Request): Promise<OAuthProps | null> {
  const id = uuid.safeParse(request.headers.get(VM_GRANT_HEADER));
  const proof = request.headers.get(VM_PROOF_HEADER);
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
  if (!id.success || !proof || proof.length > 4096 || !token || token.length > 16_384) return null;
  try {
    const db = databaseFor(env);
    const initial = await activeGrant(db.pool, id.data);
    if (!initial) return null;
    requireVmGrantProvider(initial.provider_kind);
    const claims = await verifyProof(request, token, proof, initial, Math.floor(Date.now() / 1000));
    const provider = await flyVmGrantProvider(env, initial);
    const identity = await provider.authenticate(token, initial);
    return await db.transaction(async client => {
      const current = await activeGrant(client, initial.id, initial.tenant_id, true);
      if (!current || identity.expiresAt <= Date.now() / 1000 || claims.iat + proofLifetime <= Date.now() / 1000) return null;
      const inserted = await client.query(
        `INSERT INTO app.vm_permission_proofs(tenant_id,grant_id,proof_id,expires_at)
         VALUES($1,$2,$3,to_timestamp($4)) ON CONFLICT DO NOTHING`,
        [current.tenant_id, current.id, claims.jti, claims.iat + proofLifetime],
      );
      if (inserted.rowCount !== 1) return null;
      return {
        tenantId: current.tenant_id,
        userId: current.id,
        sessionVersion: 0,
        authMethod: "vm",
        vmGrantId: current.id,
        vmTokenExpiresAt: identity.expiresAt,
        scopes: await currentVmScopes(client, current.tenant_id, current.scopes),
      };
    });
  } catch {
    return null;
  }
}
