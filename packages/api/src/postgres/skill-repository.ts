import { SkillContent, type SkillContentRow } from "../skill-content";
import type { Database, DatabaseClient } from "./database";
import { decrypt } from "../crypto";
export class SkillConflict extends Error {}
export class SkillReferenced extends Error { constructor(public jobs: { id: string; name: string; slug: string; enabled: boolean; projectId: string }[]) { super("Skill is referenced by saved jobs."); } }
type SkillRow = SkillContentRow & { id: string; key: string; revision: number; created_at: Date; updated_at: Date };
export class SkillRepository {
  constructor(private db: Database, private tenantId: string, private encryptionKey: string, private client?: DatabaseClient, private content = new SkillContent(), private edits?: Map<string,string>) {}
  private get sql() { return this.client ?? this.db.pool; }
  private async map(row: SkillRow, usageCount = 0, body = false) { return { id: row.id, key: row.key, revision: row.revision, ...(body ? await this.content.read(row, value => decrypt(value, this.encryptionKey), this.edits?.get(row.id)) : {}), usageCount, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
  async list(q = "", limit = 30, cursor?: string) { const result = await this.sql.query<SkillRow & { usage_count: string }>(`SELECT s.id,s.key,s.revision,s.created_at,s.updated_at, count(js.job_id)::text usage_count FROM app.skills s LEFT JOIN app.job_skills js ON js.tenant_id=s.tenant_id AND js.skill_id=s.id WHERE s.tenant_id=$1 AND ($2='' OR s.key ILIKE '%'||$2||'%') AND ($3::uuid IS NULL OR s.id < $3::uuid) GROUP BY s.tenant_id, s.id ORDER BY s.id DESC LIMIT $4`, [this.tenantId, q, cursor ?? null, limit + 1]); const page = result.rows.slice(0, limit); return { items: await Promise.all(page.map(row => this.map(row, Number(row.usage_count)))), nextCursor: result.rows.length > limit ? page.at(-1)!.id : null }; }
  async get(idOrKey: string, includeBody = true) {
    // A shared parameter for UUID and text comparisons is inferred as UUID by
    // PostgreSQL. Keep the key parameter separate, and never cast keys to UUID.
    const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey) ? idOrKey : null;
    const row = (await this.sql.query<SkillRow>(
      "SELECT * FROM app.skills WHERE tenant_id=$1 AND (id=$2::uuid OR key=$3::text) LIMIT 1",
      [this.tenantId, id, idOrKey],
    )).rows[0];
    return row ? this.map(row, 0, includeBody) : null;
  }
  async create(key: string, body: string) {
    if (!this.edits) throw new Error("Skill creation requires a repository edit");
    const id = crypto.randomUUID();
    this.edits.set(id, body);
    try {
      const result = await this.sql.query<SkillRow>(
        "INSERT INTO app.skills(tenant_id,id,key) VALUES($1,$2,$3) RETURNING *", [this.tenantId, id, key],
      );
      return this.map(result.rows[0], 0, true);
    } catch (error: any) {
      if (error.code === "23505") throw new SkillConflict("Skill key is already in use.");
      throw error;
    }
  }
  async update(id: string, input: { key?: string; body?: string; expectedRevision: number }) {
    if (!this.edits) throw new Error("Skill update requires a repository edit");
    const { rows } = await this.sql.query<SkillRow>(
      "SELECT revision FROM app.skills WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenantId, id],
    );
    if (!rows.length) return null;
    if (rows[0].revision !== input.expectedRevision) throw new SkillConflict("Skill changed since it was loaded.");
    if (input.body !== undefined) this.edits.set(id, input.body);
    try {
      const result = await this.sql.query<SkillRow>(
        "UPDATE app.skills SET key=COALESCE($3,key),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [this.tenantId, id, input.key ?? null],
      );
      return this.map(result.rows[0], 0, true);
    } catch (error: any) {
      if (error.code === "23505") throw new SkillConflict("Skill key is already in use.");
      throw error;
    }
  }
  async remove(id: string, expectedRevision: number) { const remove = async (client: DatabaseClient) => { const skill = (await client.query<SkillRow>("SELECT * FROM app.skills WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.tenantId, id])).rows[0]; if (!skill) return false; if (skill.revision !== expectedRevision) throw new SkillConflict("Skill changed since it was loaded."); const refs = (await client.query<any>("SELECT j.id,j.name,j.slug,j.enabled,j.project_id FROM app.jobs j JOIN app.job_skills js ON js.tenant_id=j.tenant_id AND js.job_id=j.id WHERE js.tenant_id=$1 AND js.skill_id=$2 ORDER BY j.name", [this.tenantId, id])).rows; if (refs.length) throw new SkillReferenced(refs); await client.query("DELETE FROM app.skills WHERE tenant_id=$1 AND id=$2", [this.tenantId, id]); return true; }; return this.client ? remove(this.client) : this.db.transaction(remove); }
  async jobs(id: string) { return (await this.sql.query("SELECT j.id,j.name,j.slug,j.enabled,j.project_id FROM app.jobs j JOIN app.job_skills js ON js.tenant_id=j.tenant_id AND js.job_id=j.id WHERE js.tenant_id=$1 AND js.skill_id=$2 ORDER BY j.name", [this.tenantId, id])).rows; }
}
