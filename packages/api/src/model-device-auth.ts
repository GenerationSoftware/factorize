import {z} from "zod";
import {decrypt, encrypt} from "./crypto";
import type {Env, OAuthProps} from "./types";
import {databaseFor} from "./postgres/database";
import {CredentialRepository} from "./postgres/credential-repository";

export const CODEX_AUTH_ORIGIN = "https://auth.openai.com";
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const modelAuthorizationState = z.object({
  state: z.enum(["pending", "authorized", "idle", "canceled", "expired", "failed", "reauthentication-required"]),
  verificationUrl: z.literal("https://auth.openai.com/codex/device").optional(), userCode: z.string().optional(), pollAfterSeconds: z.number().int().min(1).max(30).optional(),
});
type State = z.infer<typeof modelAuthorizationState>;
type Pending = {deviceAuthId: string; userCode: string; interval: number};
export class ModelAuthorizationUnavailable extends Error { constructor() {super("Model account authorization is unavailable. Try connecting again.");} }
export class ModelAccountUnavailable extends Error { constructor() {super("Model account not found.");} }
const value = (v: unknown, max=16_384): v is string => typeof v==="string" && v.length>0 && v.length<=max && !/[\r\n]/.test(v);
export function modelCredentialConfigured(payload: string): boolean {
  try {const auth=JSON.parse(payload); return value(auth.OPENAI_API_KEY) || value(auth.tokens?.access_token);}
  catch {return false;}
}
type AuthEndpoint = "https://auth.openai.com/api/accounts/deviceauth/usercode" | "https://auth.openai.com/api/accounts/deviceauth/token" | "https://auth.openai.com/oauth/token";
async function post(endpoint: AuthEndpoint, body: unknown, form=false): Promise<Response> {
  return fetch(endpoint, {method: "POST", headers: {"Content-Type": form ? "application/x-www-form-urlencoded" : "application/json", Accept: "application/json"}, body: form ? String(body) : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(10_000)});
}
const challenge = (pending: Pending): State => ({state: "pending", verificationUrl: "https://auth.openai.com/codex/device", userCode: pending.userCode, pollAfterSeconds: pending.interval});

/** Owner-only device login. All device IDs, PKCE/code exchanges and tokens stay
 * server-side; only a one-time user code and fixed verification URL are public.
 * Collection/account locks serialize login, refresh, rotation and disconnection. */
export async function modelDeviceAuthorization(env: Env, owner: OAuthProps, accountId: string, action: "authorize" | "status" | "cancel"): Promise<State> {
  const database=databaseFor(env), repository=new CredentialRepository(database, owner.tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
  let result: State={state: "idle"};
  try {
    const saved=await repository.refreshManagedModel(accountId, async (payload, client) => {
      const row=(await client.query<{user_id: string; session_version: number; encrypted_payload: string; expires_at: Date; next_poll_at: Date}>("SELECT user_id,session_version,encrypted_payload,expires_at,next_poll_at FROM app.model_device_authorizations WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE", [owner.tenantId,accountId])).rows[0];
      const clear=()=>client.query("DELETE FROM app.model_device_authorizations WHERE tenant_id=$1 AND account_id=$2", [owner.tenantId,accountId]);
      if (action==="cancel") {await clear(); result={state:"canceled"}; return payload;}
      const live=row && row.expires_at.getTime()>Date.now() && row.user_id===owner.userId && row.session_version===owner.sessionVersion;
      let pending: Pending | undefined;
      if (live) pending=JSON.parse(await decrypt(row.encrypted_payload,env.CREDENTIAL_ENCRYPTION_KEY));
      if (action==="authorize") {
        if (pending) {result=challenge(pending); return payload;}
        const response=await post("https://auth.openai.com/api/accounts/deviceauth/usercode", {client_id:CODEX_CLIENT_ID});
        if (!response.ok) {await response.body?.cancel(); throw new ModelAuthorizationUnavailable();}
        const data=await response.json() as Record<string,unknown>;
        const userCode=data.user_code ?? data.usercode, interval=Math.max(1,Math.min(30,Number(data.interval) || 5));
        if (!value(data.device_auth_id,4096) || !value(userCode,128) || !Number.isInteger(interval)) throw new ModelAuthorizationUnavailable();
        pending={deviceAuthId:data.device_auth_id,userCode,interval};
        const encrypted=await encrypt(JSON.stringify(pending),env.CREDENTIAL_ENCRYPTION_KEY);
        await client.query(`INSERT INTO app.model_device_authorizations(tenant_id,account_id,user_id,session_version,encrypted_payload,expires_at,next_poll_at)
          VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes',now()+($6::int*interval '1 second'))
          ON CONFLICT(tenant_id,account_id) DO UPDATE SET user_id=excluded.user_id,session_version=excluded.session_version,encrypted_payload=excluded.encrypted_payload,expires_at=excluded.expires_at,next_poll_at=excluded.next_poll_at`, [owner.tenantId,accountId,owner.userId,owner.sessionVersion,encrypted,interval]);
        result=challenge(pending); return payload;
      }
      if (!pending) {if(row) await clear(); result={state:row ? "expired" : modelCredentialConfigured(payload) ? "authorized" : "idle"}; return payload;}
      if (row!.next_poll_at.getTime()>Date.now()) {result=challenge(pending); return payload;}
      const response=await post("https://auth.openai.com/api/accounts/deviceauth/token", {device_auth_id:pending.deviceAuthId,user_code:pending.userCode});
      if (response.status===403 || response.status===404) {
        await response.body?.cancel();
        await client.query("UPDATE app.model_device_authorizations SET next_poll_at=now()+($3::int*interval '1 second') WHERE tenant_id=$1 AND account_id=$2",[owner.tenantId,accountId,pending.interval]);
        result=challenge(pending); return payload;
      }
      if (!response.ok) {await response.body?.cancel(); await clear(); result={state:"failed"}; return payload;}
      const code=await response.json() as Record<string,unknown>;
      if (!value(code.authorization_code,4096) || !value(code.code_verifier,4096) || !value(code.code_challenge,4096)) {await clear(); result={state:"failed"}; return payload;}
      const digest=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code.code_verifier))).toString("base64url");
      if (digest!==code.code_challenge) {await clear(); result={state:"failed"}; return payload;}
      // A code may have been consumed even on a failed response. Do not retry
      // this token exchange or overwrite an existing credential on ambiguity.
      let tokens: Record<string,unknown>;
      try {
        const exchanged=await post("https://auth.openai.com/oauth/token",new URLSearchParams({grant_type:"authorization_code",client_id:CODEX_CLIENT_ID,code:code.authorization_code,code_verifier:code.code_verifier,redirect_uri:`${CODEX_AUTH_ORIGIN}/deviceauth/callback`}),true);
        if (!exchanged.ok) {await exchanged.body?.cancel(); throw new Error();}
        tokens=await exchanged.json() as Record<string,unknown>;
        if (!value(tokens.access_token) || !value(tokens.refresh_token) || !value(tokens.id_token)) throw new Error();
      } catch {await clear(); result={state:"reauthentication-required"}; return payload;}
      let account: unknown;
      try {account=JSON.parse(Buffer.from(String(tokens.id_token).split(".")[1]!,"base64url").toString("utf8"))["https://api.openai.com/auth"]?.chatgpt_account_id;} catch { /* The upstream access token can select its default account. */ }
      await clear(); result={state:"authorized"};
      return JSON.stringify({auth_mode:"chatgpt",OPENAI_API_KEY:null,tokens:{...tokens,...(value(account,512) ? {account_id:account} : {}),oauth_provenance:{issuer:CODEX_AUTH_ORIGIN,client_id:CODEX_CLIENT_ID}},last_refresh:new Date().toISOString()});
    });
    if (saved===null) throw new ModelAccountUnavailable();
    return result;
  } catch (error) {
    if (error instanceof ModelAccountUnavailable) throw error;
    throw new ModelAuthorizationUnavailable();
  }
}
