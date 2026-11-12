import type { Database } from "./database";

export type RegisteredProxy = { tenantId: string; proxyIdentity: string; bootEpoch: string; controlCredential: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = async (token: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));

/** Credentials for the Factorize-to-proxy control plane. These are never job run credentials. */
export class ProxyControlRepository {
  constructor(private database: Database) {}

  /** Called only from the authenticated infrastructure provisioning path; the token is returned once. */
  async provisionCredential(tenantId: string, proxyIdentity: string, bootEpoch: string): Promise<string> {
    if (!uuid.test(tenantId) || !proxyIdentity.trim() || proxyIdentity.length > 255 || !uuid.test(bootEpoch)) throw new TypeError("Invalid proxy identity or boot epoch");
    const token = `fzc_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    await this.database.pool.query(`INSERT INTO app.credential_proxy_control_credentials(tenant_id,proxy_identity,boot_epoch,token_digest,revoked_at,consumed_at)
      VALUES ($1,$2,$3,$4,NULL,NULL) ON CONFLICT (tenant_id,proxy_identity) DO UPDATE SET boot_epoch=excluded.boot_epoch,token_digest=excluded.token_digest,proxy_token_digest=NULL,revoked_at=NULL,consumed_at=NULL,created_at=now()`,
    [tenantId, proxyIdentity, bootEpoch, Buffer.from(await digest(token))]);
    return token;
  }

  async authenticate(token: string): Promise<Pick<RegisteredProxy, "tenantId" | "proxyIdentity"> | null> {
    if (typeof token !== "string" || !/^fzc_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.database.pool.query<{ tenant_id: string; proxy_identity: string }>(`SELECT tenant_id,proxy_identity
      FROM app.credential_proxy_control_credentials WHERE token_digest=$1 AND revoked_at IS NULL`, [Buffer.from(await digest(token))]);
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, proxyIdentity: row.proxy_identity } : null;
  }

  async registerBoot(token: string, bootEpoch: string, browserOrigin: string): Promise<RegisteredProxy | null> {
    if (!uuid.test(bootEpoch)) throw new TypeError("bootEpoch must be a UUID");
    const parsedOrigin = new URL(browserOrigin);
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== browserOrigin || parsedOrigin.username || parsedOrigin.password) throw new TypeError("browser origin must be canonical HTTPS");
    const tokenDigest = Buffer.from(await digest(token));
    return this.database.transaction(async client => {
      const credential = await client.query<{ tenant_id: string; proxy_identity: string }>(`SELECT tenant_id,proxy_identity
        FROM app.credential_proxy_control_credentials WHERE token_digest=$1 AND boot_epoch=$2 AND revoked_at IS NULL AND consumed_at IS NULL FOR UPDATE`, [tokenDigest, bootEpoch]);
      const identity = credential.rows[0];
      if (!identity) return null;
      const saved = await client.query(`INSERT INTO app.credential_proxy_states(tenant_id,proxy_identity,boot_epoch)
        VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET proxy_identity=excluded.proxy_identity,boot_epoch=excluded.boot_epoch,unlocked=false,updated_at=now()
        WHERE app.credential_proxy_states.proxy_identity=excluded.proxy_identity
          AND app.credential_proxy_states.disabled_at IS NULL AND app.credential_proxy_states.revoked_at IS NULL RETURNING tenant_id`,
      [identity.tenant_id, identity.proxy_identity, bootEpoch]);
      if (!saved.rowCount) return null;
      const proxyToken = `fzc_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
      await client.query(`UPDATE app.credential_proxy_control_credentials SET consumed_at=now(),proxy_token_digest=$3
        WHERE token_digest=$1 AND boot_epoch=$2 AND consumed_at IS NULL`, [tokenDigest, bootEpoch, Buffer.from(await digest(proxyToken))]);
      await client.query(`UPDATE app.credential_run_grants SET revoked_at=now()
        WHERE tenant_id=$1 AND proxy_identity=$2 AND boot_epoch<>$3 AND revoked_at IS NULL`, [identity.tenant_id, identity.proxy_identity, bootEpoch]);
      await client.query(`INSERT INTO app.credential_proxy_browser_pairings(tenant_id,proxy_identity,boot_epoch,browser_origin)
        VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET proxy_identity=excluded.proxy_identity,
          boot_epoch=excluded.boot_epoch,browser_origin=excluded.browser_origin,updated_at=now()`,
      [identity.tenant_id, identity.proxy_identity, bootEpoch, browserOrigin]);
      return { tenantId: identity.tenant_id, proxyIdentity: identity.proxy_identity, bootEpoch, controlCredential: proxyToken };
    });
  }

  async browserPairing(tenantId: string): Promise<{ proxyIdentity: string; bootEpoch: string; browserOrigin: string } | null> {
    const result = await this.database.pool.query<{ proxy_identity: string; boot_epoch: string; browser_origin: string }>(
      `SELECT b.proxy_identity,b.boot_epoch,b.browser_origin FROM app.credential_proxy_browser_pairings b
       JOIN app.credential_proxy_states p ON p.tenant_id=b.tenant_id AND p.proxy_identity=b.proxy_identity AND p.boot_epoch=b.boot_epoch
       WHERE b.tenant_id=$1 AND p.disabled_at IS NULL AND p.revoked_at IS NULL`, [tenantId]);
    const row = result.rows[0];
    return row ? { proxyIdentity: row.proxy_identity, bootEpoch: row.boot_epoch, browserOrigin: row.browser_origin } : null;
  }

  /** Authenticates the proxy's memory-held control credential against its current registered boot. */
  async authenticateProxy(token: string): Promise<Pick<RegisteredProxy, "tenantId" | "proxyIdentity" | "bootEpoch"> | null> {
    if (typeof token !== "string" || !/^fzc_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.database.pool.query<{ tenant_id: string; proxy_identity: string; boot_epoch: string }>(`SELECT c.tenant_id,c.proxy_identity,c.boot_epoch
      FROM app.credential_proxy_control_credentials c JOIN app.credential_proxy_states p
        ON p.tenant_id=c.tenant_id AND p.proxy_identity=c.proxy_identity AND p.boot_epoch=c.boot_epoch
      WHERE c.proxy_token_digest=$1 AND c.revoked_at IS NULL AND p.disabled_at IS NULL AND p.revoked_at IS NULL`, [Buffer.from(await digest(token))]);
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, proxyIdentity: row.proxy_identity, bootEpoch: row.boot_epoch } : null;
  }

  async reportRuntimeStatus(token: string, bootEpoch: string, unlocked: boolean): Promise<boolean> {
    if (!uuid.test(bootEpoch) || typeof unlocked !== "boolean") throw new TypeError("Invalid proxy runtime status");
    const identity = await this.authenticateProxy(token);
    if (!identity || identity.bootEpoch !== bootEpoch) return false;
    const result = await this.database.pool.query(`UPDATE app.credential_proxy_states SET unlocked=$3,updated_at=now()
      WHERE tenant_id=$1 AND proxy_identity=$2 AND boot_epoch=$4 AND disabled_at IS NULL AND revoked_at IS NULL`,
    [identity.tenantId, identity.proxyIdentity, unlocked, bootEpoch]);
    return Boolean(result.rowCount);
  }

  async revokeCredential(tenantId: string, proxyIdentity: string): Promise<boolean> {
    const result = await this.database.pool.query(`UPDATE app.credential_proxy_control_credentials SET revoked_at=now()
      WHERE tenant_id=$1 AND proxy_identity=$2 AND revoked_at IS NULL`, [tenantId, proxyIdentity]);
    return Boolean(result.rowCount);
  }
}
