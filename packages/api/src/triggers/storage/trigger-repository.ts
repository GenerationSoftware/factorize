import { lockIntegrationTopology, validateTopologySources } from "../../integrations/storage/integration-removal-topology";
import type { TriggerSource, Trigger, TriggerRepository } from "../domain/trigger-domain";
import { nextOccurrence, validateScheduleConfig } from "../domain/schedule";
import type { Database, DatabaseClient } from "../../postgres/database";

export class StaleTriggerEdit extends Error {}
type SourceRow = { id: string; trigger_id: string; kind: TriggerSource["kind"]; slug: string; enabled: boolean; config: Record<string, unknown>; encrypted_template: string | null; created_at: Date; updated_at: Date };
type TriggerRow = { input_mapping: Trigger["inputMapping"] | null; id: string; event_definition_id: string; name: string; description: string; slug: string; revision: number; enabled: boolean; created_at: Date; updated_at: Date };
type Crypt = (value: string) => Promise<string>;

/** Tenant-scoped persistence for input Triggers and their input source configs. */
export class PostgresTriggerRepository implements TriggerRepository {
  constructor(private database: Database, private tenantId: string, private encrypt: Crypt, private decrypt: Crypt) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  private async mapped(client: Pick<DatabaseClient, "query">, row: TriggerRow): Promise<Trigger> {
    const sources = await client.query<SourceRow>(`SELECT id,trigger_id,kind,slug,enabled,config,encrypted_template,created_at,updated_at FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND removed_at IS NULL ORDER BY position,created_at,id`, [this.tenantId,row.id]);
    return { id: row.id, eventId: row.event_definition_id, name: row.name, description: row.description, ...(row.input_mapping ? {inputMapping: row.input_mapping} : {}), slug: row.slug, revision: row.revision, enabled: row.enabled,
      sources: await Promise.all(sources.rows.map(async source => ({ id: source.id, triggerId: source.trigger_id, kind: source.kind, slug: source.slug, enabled: source.enabled, config: source.config, ...(source.encrypted_template ? {template: await this.decrypt(source.encrypted_template)} : {}), createdAt: source.created_at.toISOString(), updatedAt: source.updated_at.toISOString() }))),
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  async getTrigger(id: string): Promise<Trigger | null> {
    const result = await this.database.pool.query<TriggerRow>(`SELECT id,event_definition_id,name,description,slug,revision,enabled,created_at,updated_at,input_mapping FROM app.triggers WHERE tenant_id=$1 AND id=$2`, [this.tenantId,id]);
    return result.rows[0] ? this.mapped(this.database.pool,result.rows[0]) : null;
  }

  async list(): Promise<Trigger[]> {
    const result = await this.database.pool.query<TriggerRow>(`SELECT id,event_definition_id,name,description,slug,revision,enabled,created_at,updated_at,input_mapping FROM app.triggers WHERE tenant_id=$1 ORDER BY name,id`, [this.tenantId]);
    return Promise.all(result.rows.map(row => this.mapped(this.database.pool,row)));
  }

  async create(trigger: Trigger): Promise<Trigger> {
    return this.database.transaction(async client => {
      await lockIntegrationTopology(client,this.tenantId);
      await validateTopologySources(client,this.tenantId,trigger.sources,[]);
      const created = await client.query<TriggerRow>(`INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,description,slug,enabled,created_at,updated_at,input_mapping)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,event_definition_id,name,description,slug,revision,enabled,created_at,updated_at,input_mapping`, [this.tenantId,trigger.id,trigger.eventId,trigger.name,trigger.description,trigger.slug,trigger.enabled,trigger.createdAt,trigger.updatedAt,trigger.inputMapping ?? null]);
      await this.writeSources(client,trigger,[]);
      return this.mapped(client,created.rows[0]);
    });
  }

  async update(trigger: Trigger, expectedUpdatedAt?: string): Promise<Trigger> {
    return this.database.transaction(async client => {
      await lockIntegrationTopology(client,this.tenantId);
      const current = await client.query<TriggerRow>(`SELECT id,event_definition_id,name,description,slug,revision,enabled,created_at,updated_at,input_mapping FROM app.triggers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[this.tenantId,trigger.id]);
      const old = current.rows[0];
      if (!old) throw new Error("Trigger not found");
      if (expectedUpdatedAt && old.updated_at.toISOString() !== expectedUpdatedAt) throw new StaleTriggerEdit("Trigger changed since it was loaded");
      const updatedAt = new Date(Math.max(Date.parse(trigger.updatedAt),old.updated_at.getTime()+1)).toISOString();
      const saved = await client.query<TriggerRow>(`UPDATE app.triggers SET event_definition_id=$3,name=$4,description=$5,slug=$6,revision=revision+1,enabled=$7,updated_at=$8,input_mapping=$9 WHERE tenant_id=$1 AND id=$2 RETURNING id,event_definition_id,name,description,slug,revision,enabled,created_at,updated_at,input_mapping`,[this.tenantId,trigger.id,trigger.eventId,trigger.name,trigger.description,trigger.slug,trigger.enabled,updatedAt,trigger.inputMapping ?? null]);
      const existing = await client.query<SourceRow>(`SELECT id,trigger_id,kind,slug,enabled,config,encrypted_template,created_at,updated_at FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND removed_at IS NULL`,[this.tenantId,trigger.id]);
      await validateTopologySources(client,this.tenantId,trigger.sources,existing.rows);
      await this.writeSources(client,{...trigger,updatedAt},existing.rows);
      return this.mapped(client,saved.rows[0]);
    });
  }

  private async writeSources(client: Pick<DatabaseClient,"query">, trigger: Trigger, existing: SourceRow[]) {
    const wanted = new Set(trigger.sources.map(source => source.id));
    for (const old of existing) if (!wanted.has(old.id)) {
      await client.query("DELETE FROM app.schedule_state WHERE tenant_id=$1 AND event_id=$2",[this.tenantId,old.id]);
      await client.query("DELETE FROM app.events WHERE tenant_id=$1 AND id=$2",[this.tenantId,old.id]);
    }
    for (const [position,source] of trigger.sources.entries()) {
      const prior = existing.find(row => row.id===source.id);
      if (prior && prior.kind!==source.kind) throw new Error("Trigger source kind cannot change while editing; replace the input source.");
      const encryptedTemplate = source.template===undefined ? null : await this.encrypt(source.template);
      if (prior) await client.query(`UPDATE app.events SET slug=$3,enabled=$4,config=$5,encrypted_template=$6,position=$7,updated_at=$8 WHERE tenant_id=$1 AND id=$2`,[this.tenantId,source.id,source.slug,source.enabled,source.config,encryptedTemplate,position,trigger.updatedAt]);
      else await client.query(`INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,enabled,config,encrypted_template,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[this.tenantId,source.id,trigger.id,source.kind,source.slug,source.enabled,source.config,encryptedTemplate,position,source.createdAt,trigger.updatedAt]);
      if (source.kind==="schedule") {
        const next = trigger.enabled && source.enabled ? nextOccurrence(validateScheduleConfig(source.config),new Date()) : null;
        await client.query(`INSERT INTO app.schedule_state(tenant_id,event_id,trigger_id,next_run_at) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,event_id) DO UPDATE SET trigger_id=excluded.trigger_id,next_run_at=excluded.next_run_at`,[this.tenantId,source.id,trigger.id,next]);
      } else await client.query("DELETE FROM app.schedule_state WHERE tenant_id=$1 AND event_id=$2",[this.tenantId,source.id]);
    }
  }

  async setEnabled(id: string, enabled: boolean, changedAt: string): Promise<boolean> {
    return this.database.transaction(async client => {
      await lockIntegrationTopology(client,this.tenantId);
      const updated = await client.query(`UPDATE app.triggers SET enabled=$3,updated_at=greatest($4::timestamptz,date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING id`,[this.tenantId,id,enabled,changedAt]);
      if (!updated.rowCount) return false;
      const sources = await client.query<SourceRow>(`SELECT id,trigger_id,kind,slug,enabled,config,encrypted_template,created_at,updated_at FROM app.events WHERE tenant_id=$1 AND trigger_id=$2 AND kind='schedule' AND removed_at IS NULL`,[this.tenantId,id]);
      for (const source of sources.rows) {
        const next = enabled && source.enabled ? nextOccurrence(validateScheduleConfig(source.config),new Date()) : null;
        await client.query("UPDATE app.schedule_state SET next_run_at=$3 WHERE tenant_id=$1 AND event_id=$2",[this.tenantId,source.id,next]);
      }
      return true;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.database.transaction(async sql=>{
      await lockIntegrationTopology(sql,this.tenantId);
      const result = await sql.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND id=$2 RETURNING id",[this.tenantId,id]);
      return result.rowCount===1;
    });
  }
}
