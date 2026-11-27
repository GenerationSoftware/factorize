import type { DatabaseClient } from "../../postgres/database";
import type { OAuthProps } from "../../types";

export type VmProvider = "exe" | "fly";
export type VmTarget = {
  provider_id: string;
  provider_kind: VmProvider;
  provider_epoch: number;
  vm: string;
  vm_app: string;
};
export type VmIdentityBinding = {
  machine_key: string;
  issuer: string;
  subject: string;
  public_key: JsonWebKey;
};
export type VmGrant = VmTarget & {
  tenant_id: string;
  id: string;
  request_key: string;
  created_by: string;
  scopes: string[];
  preset_id: string | null;
  revision: number;
  machine_key: string | null;
  issuer: string | null;
  subject: string | null;
  public_key: JsonWebKey | null;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
  revoked_at: Date | null;
};

export function vmGrantActor(auth: OAuthProps) {
  if (auth.vmGrantId) return `vm:${auth.vmGrantId}`;
  if (auth.oauthGrantId) return `oauth:${auth.oauthGrantId}`;
  if (auth.accessTokenId) return `access_token:${auth.accessTokenId}`;
  return `session:${auth.userId}`;
}

export class VmGrantRepository {
  constructor(private db: DatabaseClient, private tenantId: string) {}

  async list() {
    const { rows } = await this.db.query<VmGrant>(
      `SELECT g.* FROM app.vm_permission_grants g
       WHERE g.tenant_id=$1 AND g.activated_at IS NOT NULL AND g.revoked_at IS NULL ORDER BY g.created_at DESC, g.id`,
      [this.tenantId],
    );
    return rows;
  }

  async get(id: string, lock = false) {
    return (await this.db.query<VmGrant>(
      `SELECT * FROM app.vm_permission_grants WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [this.tenantId, id],
    )).rows[0];
  }

  async reserve(target: VmTarget, requestKey: string, scopes: string[], presetId: string | null, actor: string) {
    const { rows } = await this.db.query<VmGrant>(
      `INSERT INTO app.vm_permission_grants
         (tenant_id,provider_id,provider_kind,provider_epoch,vm,vm_app,request_key,scopes,preset_id,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT DO NOTHING RETURNING *`,
      [this.tenantId, target.provider_id, target.provider_kind, target.provider_epoch, target.vm, target.vm_app,
        requestKey, scopes, presetId, actor],
    );
    if (rows[0]) return { grant: rows[0], created: true };
    const existing = (await this.db.query<VmGrant>(
      "SELECT * FROM app.vm_permission_grants WHERE tenant_id=$1 AND request_key=$2", [this.tenantId, requestKey],
    )).rows[0];
    return { grant: existing, created: false };
  }

  async activate(id: string, binding: VmIdentityBinding) {
    return (await this.db.query<VmGrant>(
      `UPDATE app.vm_permission_grants SET machine_key=$3,issuer=$4,subject=$5,public_key=$6,activated_at=now(),updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND activated_at IS NULL AND revoked_at IS NULL RETURNING *`,
      [this.tenantId, id, binding.machine_key, binding.issuer, binding.subject, binding.public_key],
    )).rows[0];
  }

  async replace(id: string, revision: number, scopes: string[], presetId: string | null, actor: string) {
    return (await this.db.query<VmGrant>(
      `UPDATE app.vm_permission_grants SET scopes=$4,preset_id=$5,revision=revision+1,updated_at=now(),updated_by=$6
       WHERE tenant_id=$1 AND id=$2 AND revision=$3 AND activated_at IS NOT NULL AND revoked_at IS NULL RETURNING *`,
      [this.tenantId, id, revision, scopes, presetId, actor],
    )).rows[0];
  }

  async revoke(id: string, actor: string) {
    return (await this.db.query<VmGrant>(
      `UPDATE app.vm_permission_grants
       SET revoked_at=now(),updated_at=now(),updated_by=$3,cleaned_at=CASE WHEN provider_kind='fly' THEN now() ELSE NULL END
       WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING *`,
      [this.tenantId, id, actor],
    )).rows[0];
  }
}
