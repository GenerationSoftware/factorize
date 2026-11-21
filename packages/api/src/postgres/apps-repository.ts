import type { z } from "zod";
import { randomBytes } from "node:crypto";
import { accessTokenDigest } from "../access-tokens";
import type { appRegistrationInput, appRegistrationUpdate, registeredApp } from "../apps-contracts";
import type { Database } from "./database";

const metadata = 'id,name,redirect_uris AS "redirectUris",is_public AS "public",enabled,secret_digest IS NOT NULL AS "secretConfigured"';
type App = z.infer<typeof registeredApp>;

export class AppsRepository {
  constructor(private db: Database, private teamId: string) {}

  async list() {
    return (await this.db.pool.query<App>(`SELECT ${metadata} FROM app.oauth_apps
      WHERE tenant_id=$1 ORDER BY lower(name),id`, [this.teamId])).rows;
  }

  async find(id: string) {
    return (await this.db.pool.query<App>(`SELECT ${metadata} FROM app.oauth_apps WHERE tenant_id=$1 AND id=$2`, [this.teamId, id])).rows[0];
  }

  async create(input: z.infer<typeof appRegistrationInput>) {
    return (await this.db.pool.query<App>(`INSERT INTO app.oauth_apps(tenant_id,name,redirect_uris,is_public)
      VALUES($1,$2,$3,$4) RETURNING ${metadata}`, [this.teamId, input.name, input.redirectUris, input.public])).rows[0];
  }

  async update(id: string, input: z.infer<typeof appRegistrationUpdate>) {
    return this.db.transaction(async tx => {
      const { rows: [app] } = await tx.query<App>(`UPDATE app.oauth_apps SET name=$3,redirect_uris=$4,is_public=$5,enabled=$6
        WHERE tenant_id=$1 AND id=$2 RETURNING ${metadata}`, [this.teamId, id, input.name, input.redirectUris, input.public, input.enabled]);
      if (!app) return undefined;
      if (!app.enabled || !app.public) await tx.query(`UPDATE app.oauth_app_connections SET revoked_at=now()
        WHERE app_id=$1 AND revoked_at IS NULL AND ($2 OR tenant_id<>$3)`, [id, !app.enabled, this.teamId]);
      return app;
    });
  }

  async rotateSecret(id: string) {
    const clientSecret = randomBytes(32).toString("base64url");
    const result = await this.db.pool.query(`UPDATE app.oauth_apps SET secret_digest=$3, secret_version=secret_version+1
      WHERE tenant_id=$1 AND id=$2`, [this.teamId, id, await accessTokenDigest(clientSecret)]);
    return result.rowCount ? { clientId: id, clientSecret } : undefined;
  }

  async connected(userId: string) {
    const { rows } = await this.db.pool.query<{id: string; appId: string; name: string; scopes: string[]; authorizedAt: Date}>(`
      SELECT c.id,c.app_id AS "appId",a.name,c.scopes,c.authorized_at AS "authorizedAt"
      FROM app.oauth_app_connections c JOIN app.oauth_apps a ON a.id=c.app_id
      WHERE c.tenant_id=$1 AND c.user_id=$2 AND c.revoked_at IS NULL AND a.enabled
      ORDER BY c.authorized_at DESC,c.id`, [this.teamId, userId]);
    return rows.map(row => ({ ...row, authorizedAt: row.authorizedAt.toISOString() }));
  }

  async revoke(userId: string, id: string) {
    const result = await this.db.pool.query(`UPDATE app.oauth_app_connections SET revoked_at=coalesce(revoked_at,now())
      WHERE tenant_id=$1 AND user_id=$2 AND id=$3`, [this.teamId, userId, id]);
    return Boolean(result.rowCount);
  }
}
