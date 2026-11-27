import { z } from "zod";
import { signingConfig } from "../../config/runtime";
import { databaseFor } from "../../postgres/database";
import { AgentApiError } from "../../proxy/api/agent-api-error";
import { requiredIntegrationScope, type AgentIntegration } from "../../proxy/application/agent-integration-access";
import type { Env, OAuthProps } from "../../types";
import { activeVmAuthorization } from "../../vm-grants/application/vm-auth";
import { ghcrImage } from "../api/ghcr-contracts";
import { GhcrConnections } from "../storage/ghcr-connections";

export const ghcrRegistryHost = "ghcr.factorize.sh";
const username = "factorize";
const lifetime = 900;
const encode = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
const action = z.enum(["pull", "push"]);
export const ghcrLoginInput = z.strictObject({ image: ghcrImage, access: action });
export const ghcrLoginOutput = z.object({
  registry: z.literal(ghcrRegistryHost), image: z.string(),
  username: z.literal(username), password: z.string(), expiresAt: z.iso.datetime(),
});
const claim = z.strictObject({
  tenant: z.uuid(), grant: z.uuid(), connection: z.uuid(), integration: z.uuid(),
  epoch: z.number().int().positive(), revision: z.number().int().positive(), scope: z.string(),
  access: action, exp: z.number().int().positive(), nonce: z.uuid(),
});

type Claim = z.infer<typeof claim>;
const denied = () => new AgentApiError(403, "forbidden", "The workload does not have the required GitHub Container Registry permission.");
const bytesToUrl = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromUrl = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
const message = (body: string) => encode.encode("factorize:ghcr-workload:v1:" + body);
async function signingKey(env: Env, usages: KeyUsage[]) {
  const secret = signingConfig(env).sessionSecret;
  if (!secret) throw new Error("Missing registry signing secret.");
  return crypto.subtle.importKey("raw", encode.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, usages);
}

export function ghcrPushCredentialId(connection: string) { return connection + ":push"; }
export function isGhcrPushIntegration(row: Pick<AgentIntegration, "kind" | "credential_id">) {
  return row.kind === "ghcr" && row.credential_id.endsWith(":push");
}

export async function issueGhcrLogin(env: Env, auth: OAuthProps, value: z.infer<typeof ghcrLoginInput>) {
  if (auth.authMethod !== "vm" || !auth.vmGrantId || !auth.vmTokenExpiresAt) throw denied();
  const scopes = await activeVmAuthorization(env, auth);
  if (!scopes?.includes("proxy:use")) throw denied();
  const db = databaseFor(env);
  const selected = (await db.pool.query<AgentIntegration & { connection: string; grant_revision: number }>(
    `SELECT i.*, c.id AS connection, g.revision AS grant_revision
       FROM app.ghcr_connections c JOIN app.agent_integrations i
       ON i.tenant_id=c.tenant_id AND i.kind='ghcr' AND i.credential_id=c.id::text || $3::text
      JOIN app.vm_permission_grants g ON g.tenant_id=c.tenant_id AND g.id=$4
      WHERE c.tenant_id=$1 AND c.image=$2 AND i.available AND i.policy<>'disabled'`,
    [auth.tenantId,value.image,value.access === "push" ? ":push" : "", auth.vmGrantId])).rows[0];
  if (!selected || !scopes.includes(requiredIntegrationScope(selected))) throw denied();
  const exp = Math.min(Math.floor(Date.now()/1000) + lifetime, Math.floor(auth.vmTokenExpiresAt));
  if (exp <= Math.floor(Date.now()/1000)) throw denied();
  const claims: Claim = {tenant:auth.tenantId,grant:auth.vmGrantId,connection:selected.connection,
    integration:selected.id,epoch:selected.operation_epoch,revision:selected.grant_revision,scope:requiredIntegrationScope(selected),access:value.access,exp,nonce:crypto.randomUUID()};
  await checkGhcrLogin(env, claims);
  const encoded = bytesToUrl(encode.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env, ["sign"]), message(encoded)));
  return {registry:ghcrRegistryHost, image:value.image, username,
    password:"fzgh1." + encoded + "." + bytesToUrl(signature), expiresAt:new Date(exp*1000).toISOString()} as const;
}

export async function readGhcrLogin(env: Env, request: Request): Promise<Claim | null> {
  const basic = request.headers.get("Authorization")?.match(/^Basic ([A-Za-z0-9+/=]{1,4096})$/i)?.[1];
  if (!basic) return null;
  try {
    const token = atob(basic).match(/^factorize:fzgh1\.([A-Za-z0-9_-]{1,2000})\.([A-Za-z0-9_-]{43})$/);
    if (!token || !await crypto.subtle.verify("HMAC", await signingKey(env, ["verify"]), fromUrl(token[2]), message(token[1]))) return null;
    const claims = claim.parse(JSON.parse(decode.decode(fromUrl(token[1]))));
    return claims.exp > Math.floor(Date.now()/1000) ? claims : null;
  } catch { return null; }
}

export async function checkGhcrLogin(env: Env, claims: Claim) {
  const scopes = await activeVmAuthorization(env, {
    tenantId:claims.tenant,userId:claims.grant,sessionVersion:0,authMethod:"vm",
    vmGrantId:claims.grant,vmTokenExpiresAt:claims.exp,scopes:["proxy:use",claims.scope],
  }, claims.revision);
  if (!scopes?.includes("proxy:use") || !scopes.includes(claims.scope)) throw denied();
  const db = databaseFor(env);
  const credentialId = claims.access === "push" ? ghcrPushCredentialId(claims.connection) : claims.connection;
  const row = (await db.pool.query<AgentIntegration>(
    "SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND id=$2 AND kind='ghcr' AND credential_id=$3 AND available AND policy<>'disabled'",
    [claims.tenant,claims.integration,credentialId])).rows[0];
  if (!row || row.operation_epoch !== claims.epoch || requiredIntegrationScope(row) !== claims.scope) throw denied();
}

export function ghcrWorkloadCredential(env: Env, claims: Claim) {
  return new GhcrConnections(databaseFor(env),claims.tenant,signingConfig(env).credentialKey).credential(claims.connection);
}
