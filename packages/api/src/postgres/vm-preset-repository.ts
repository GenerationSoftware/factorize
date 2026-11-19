import type { Database } from "./database";
import type { VmPresetInput } from "../vm-presets";

const columns = 'id, name, settings, execution_config_id AS "executionConfigId"';

export class VmPresetRepository {
  constructor(private database: Database, private tenantId: string) {}

  async list() {
    const result = await this.database.pool.query(`SELECT ${columns} FROM app.vm_presets WHERE tenant_id=$1 ORDER BY lower(name),id`, [this.tenantId]);
    return result.rows;
  }

  async save(input: VmPresetInput, id?: string) {
    return this.database.transaction(async client => {
      const previous = id && (await client.query(`SELECT ${columns} FROM app.vm_presets WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [this.tenantId, id])).rows[0];
      if (id && !previous) return null;
      const settings = input.settings;
      let configId: string;
      if (settings.provider === "exe") {
        configId = settings.connectionId;
      } else {
        const previousId = previous?.executionConfigId;
        // Reuse the exact saved configuration only while it still exists and matches.
        const match = previousId && previous.settings.provider === "fly" && (await client.query(
          "SELECT id FROM app.fly_execution_configurations WHERE tenant_id=$1 AND id=$2 AND image=$3 AND region=$4 AND size=$5",
          [this.tenantId, previousId, settings.image, settings.region, settings.size],
        )).rowCount;
        if (match) {
          configId = previousId;
        } else {
          configId = crypto.randomUUID();
          await client.query(`INSERT INTO app.fly_execution_configurations(tenant_id,id,name,image,region,size,preset_name)
            VALUES ($1,$2::uuid,($2::uuid)::text,$3,$4,$5,$6)`, [this.tenantId, configId, settings.image, settings.region, settings.size, input.name]);
        }
      }
      const values = [this.tenantId, id ?? crypto.randomUUID(), input.name, settings, configId];
      const result = id
        ? await client.query(`UPDATE app.vm_presets SET name=$3,settings=$4,execution_config_id=$5 WHERE tenant_id=$1 AND id=$2 RETURNING ${columns}`, values)
        : await client.query(`INSERT INTO app.vm_presets(tenant_id,id,name,settings,execution_config_id) VALUES ($1,$2,$3,$4,$5) RETURNING ${columns}`, values);
      return result.rows[0];
    });
  }

  async remove(id: string) {
    const result = await this.database.pool.query("DELETE FROM app.vm_presets WHERE tenant_id=$1 AND id=$2", [this.tenantId, id]);
    return Boolean(result.rowCount);
  }
}
