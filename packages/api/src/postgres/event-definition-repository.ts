import type { Database, DatabaseClient } from "./database";

interface RecordedOccurrence {
  id: string;
  definition_id: string;
  definition_revision: number;
  occurred_at: Date;
  recorded_at: string;
  payload: Record<string, unknown>;
}

function presentRecorded(row: RecordedOccurrence) {
  return {
    occurrenceId: row.id,
    definitionId: row.definition_id,
    definitionRevision: row.definition_revision,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at,
    payload: row.payload,
  };
}

// Preserve PostgreSQL's fractional precision for cursor comparisons.
const recordedFields = `id,definition_id,definition_revision,occurred_at,payload,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at`;

export interface EventDefinitionInput {
  name: string;
  description?: string;
  payloadSchema?: Record<string, unknown>;
}

export class EventDefinitionRepository {
  constructor(private database: Database, private tenantId: string) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  private async present(client: Pick<DatabaseClient, "query">, id: string) {
    const row = (await client.query<any>(`SELECT d.id,d.name,d.description,d.current_revision,d.created_at,d.updated_at,
        r.payload_schema
      FROM app.event_definitions d JOIN app.event_definition_revisions r
        ON r.tenant_id=d.tenant_id AND r.definition_id=d.id AND r.revision=d.current_revision
      WHERE d.tenant_id=$1 AND d.id=$2`, [this.tenantId, id])).rows[0];
    return row && { id: row.id, name: row.name, description: row.description, revision: row.current_revision, payloadSchema: row.payload_schema, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  async list() {
    const rows = await this.database.pool.query<any>(`SELECT d.id,d.name,d.description,d.current_revision,d.created_at,d.updated_at,
        r.payload_schema,count(DISTINCT t.id)::int trigger_count,count(DISTINCT o.id)::int occurrence_count
      FROM app.event_definitions d JOIN app.event_definition_revisions r
        ON r.tenant_id=d.tenant_id AND r.definition_id=d.id AND r.revision=d.current_revision
      LEFT JOIN app.triggers t ON t.tenant_id=d.tenant_id AND t.event_definition_id=d.id
      LEFT JOIN app.event_occurrences o ON o.tenant_id=d.tenant_id AND o.definition_id=d.id
      WHERE d.tenant_id=$1 GROUP BY d.tenant_id,d.id,d.name,d.description,d.current_revision,d.created_at,d.updated_at,r.revision,r.payload_schema ORDER BY d.name,d.id`, [this.tenantId]);
    return rows.rows.map(row => ({ id: row.id, name: row.name, description: row.description, revision: row.current_revision, payloadSchema: row.payload_schema, triggerCount: row.trigger_count, occurrenceCount: row.occurrence_count, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }));
  }

  async mcpCatalog(cursor?: string) {
    const limit = 100;
    const rows = (await this.database.pool.query<{ id: string; name: string; description: string }>(
      `SELECT id,name,description FROM app.event_definitions
       WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
      [this.tenantId, cursor ?? null, limit + 1],
    )).rows;
    const events = rows.slice(0, limit);
    return { events, nextCursor: rows.length > limit ? events.at(-1)?.id : undefined };
  }

  async occurrence(id: string) {
    const row = (await this.database.pool.query<RecordedOccurrence>(
      `SELECT ${recordedFields} FROM app.event_occurrences WHERE tenant_id=$1 AND id=$2`, [this.tenantId, id],
    )).rows[0];
    return row && presentRecorded(row);
  }

  async recordedOccurrences(definitionId: string, since: string, limit: number, boundary?: [string, string]) {
    const rows = (await this.database.pool.query<RecordedOccurrence>(
      `SELECT ${recordedFields} FROM app.event_occurrences
       WHERE tenant_id=$1 AND definition_id=$2 AND created_at>=$3
         AND ($4::timestamptz IS NULL OR (created_at,id)>($4,$5::uuid))
       ORDER BY created_at,id LIMIT $6`,
      [this.tenantId, definitionId, since, boundary?.[0] ?? null, boundary?.[1] ?? null, limit + 1],
    )).rows;
    const items = rows.slice(0, limit).map(presentRecorded);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? btoa(JSON.stringify([definitionId, since, last.recordedAt, last.occurrenceId])) : null,
    };
  }

  async get(id: string) { return this.present(this.database.pool, id); }

  async create(input: EventDefinitionInput) {
    const id = crypto.randomUUID();
    await this.database.transaction(async client => {
      await client.query(`INSERT INTO app.event_definitions(tenant_id,id,name,description,current_revision) VALUES($1,$2,$3,$4,1)`, [this.tenantId, id, input.name, input.description ?? ""]);
      await client.query(`INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema) VALUES($1,$2,1,$3)`, [this.tenantId, id, input.payloadSchema ?? { type: "object" }]);
    });
    return this.get(id);
  }

  async update(id: string, input: EventDefinitionInput, expectedRevision: number) {
    return this.database.transaction(async client => {
      const current = (await client.query<any>(`SELECT current_revision FROM app.event_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [this.tenantId, id])).rows[0];
      if (!current) return null;
      if (current.current_revision !== expectedRevision) throw new EventDefinitionConflict();
      const revision = current.current_revision + 1;
      await client.query(`INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema) VALUES($1,$2,$3,$4)`, [this.tenantId, id, revision, input.payloadSchema ?? { type: "object" }]);
      await client.query(`UPDATE app.event_definitions SET name=$3,description=$4,current_revision=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [this.tenantId, id, input.name, input.description ?? "", revision]);
      return this.present(client, id);
    });
  }

  async delete(id: string) {
    const result = await this.database.pool.query(`DELETE FROM app.event_definitions WHERE tenant_id=$1 AND id=$2 RETURNING id`, [this.tenantId, id]);
    return !!result.rowCount;
  }

  async occurrences(id: string, limit = 50, cursor?: string) {
    const definition = await this.database.pool.query(`SELECT 1 FROM app.event_definitions WHERE tenant_id=$1 AND id=$2`, [this.tenantId, id]);
    if (!definition.rowCount) return null;
    const rows = await this.database.pool.query<any>(`SELECT id,definition_revision,occurred_at,payload,producer_identity,created_at
      FROM app.event_occurrences WHERE tenant_id=$1 AND definition_id=$2 AND ($3::uuid IS NULL OR (occurred_at,id)<(SELECT occurred_at,id FROM app.event_occurrences WHERE tenant_id=$1 AND definition_id=$2 AND id=$3))
      ORDER BY occurred_at DESC,id DESC LIMIT $4`, [this.tenantId, id, cursor ?? null, limit]);
    return { items: rows.rows.map(row => ({ id: row.id, revision: row.definition_revision, occurredAt: row.occurred_at.toISOString(), payload: row.payload, producer: row.producer_identity, createdAt: row.created_at.toISOString() })), nextCursor: rows.rows.length === limit ? rows.rows.at(-1)?.id : undefined };
  }
}

export class EventDefinitionConflict extends Error {}
