import type { Database } from "./database";
import type { FlyExecutionConfigurationInput } from "../fly-execution-configurations";

export class FlyExecutionConfigurationRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }
  async list() {
    const { rows } = await this.database.pool.query("SELECT id,name,image,region,size,created_at,updated_at FROM app.fly_execution_configurations WHERE tenant_id=$1 ORDER BY created_at,id", [this.tenantId]);
    return rows.map(row => this.map(row));
  }
  async get(id: string) {
    const { rows } = await this.database.pool.query("SELECT id,name,image,region,size,created_at,updated_at FROM app.fly_execution_configurations WHERE tenant_id=$1 AND id=$2", [this.tenantId,id]);
    return rows[0] ? this.map(rows[0]) : null;
  }
  async save(input: FlyExecutionConfigurationInput, id: string = crypto.randomUUID()) {
    const { rows } = await this.database.pool.query(`INSERT INTO app.fly_execution_configurations(tenant_id,id,name,image,region,size) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id,id) DO UPDATE SET name=excluded.name,image=excluded.image,region=excluded.region,size=excluded.size,updated_at=now()
      RETURNING id,name,image,region,size,created_at,updated_at`, [this.tenantId,id,input.name,input.image,input.region,input.size]);
    return this.map(rows[0]);
  }
  async remove(id: string) { const r=await this.database.pool.query("DELETE FROM app.fly_execution_configurations WHERE tenant_id=$1 AND id=$2",[this.tenantId,id]); return (r.rowCount??0)>0; }
  private map(row: any) { return { id: row.id, name: row.name, image: row.image, region: row.region, size: row.size, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }
}
