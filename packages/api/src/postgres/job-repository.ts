import { SkillContent } from "../skill-content";
import { DEFAULT_RUN_SCOPES } from "../run-scopes";
import { submitRun } from "./run-submission";
import { lockTriggerQueue } from "./queue-admission";
import type { Invocation, Trigger, TriggerRepository, TriggerRun, Event } from "../job-domain";
import type { Database, DatabaseClient } from "./database";
import { nextOccurrence, validateScheduleConfig } from "../schedule";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { invocations, manualInvocationPermissions, triggers, triggerEditDeliveries, lifecycleDeliveries, pendingVerifications, scheduleState, events } from "./schema";

export class StaleTriggerEdit extends Error {}
export class ContextReviewRequired extends Error {}

type Crypt = (value: string) => Promise<string>;
type TriggerRow = typeof triggers.$inferSelect;
type EventRow = typeof events.$inferSelect;

export class PostgresTriggerRepository implements TriggerRepository {
  constructor(private database: Database, private tenantId: string, private encrypt: Crypt, private decrypt: Crypt, private content = new SkillContent()) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  private async decryptTemplate(value: string, eventRows: EventRow[]): Promise<string> {
    const text = await this.decrypt(value);
    const lifecycleSlugs = new Set(eventRows.filter(event => event.kind === "triggerLifecycle" || event.kind === "triggerIdle").map(event => event.slug));
    return text.replace(/\{\{\{?[^}]+\}\}\}?/g, expression => {
      const renamed = expression.replace(/(\{\{\{?\s*)trigger-([0-9]+)/g, "$1event-$2");
      return renamed.replace(/^(\{\{\{?\s*)([a-z][a-z0-9_-]*)\.(sourceJobId|source_job_id)(?=[.\s}])/, (match, prefix, slug, field) =>
        lifecycleSlugs.has(slug) ? `${prefix}${slug}.${field === "sourceJobId" ? "sourceTriggerId" : "source_trigger_id"}` : match);
    });
  }

  private async event(row: EventRow, eventRows:EventRow[]): Promise<Event> {
    return {id:row.id,triggerId:row.triggerId,kind:row.kind,slug:row.slug,enabled:row.enabled,config:row.config,
      template:row.encryptedTemplate ? await (row.legacyTemplate ? this.decryptTemplate(row.encryptedTemplate,eventRows) : this.decrypt(row.encryptedTemplate)) : undefined,
      createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
  }
  private async mapped(row: TriggerRow, db: any = this.database.orm, loadedEvents?: EventRow[], loadedSkills?: any[]): Promise<Trigger> {
    let eventRows: EventRow[];
    let skillRows: any[];
    if (db === this.database.orm) {
      [eventRows, skillRows] = await Promise.all([
        loadedEvents ?? db.select().from(events).where(and(eq(events.tenantId, this.tenantId), eq(events.triggerId, row.id), isNull(events.removedAt))).orderBy(events.position, events.createdAt, events.id),
        loadedSkills?.filter(skill => skill.trigger_id === row.id) ?? this.database.pool.query<any>("SELECT s.id,s.key,s.revision,s.encrypted_body,s.encrypted_directory,s.artifact_version,js.position,js.context_skill FROM app.trigger_skills js JOIN app.skills s ON s.tenant_id=js.tenant_id AND s.id=js.skill_id WHERE js.tenant_id=$1 AND js.trigger_id=$2 ORDER BY js.position", [this.tenantId, row.id]).then(result => result.rows),
      ]);
    } else {
      eventRows = loadedEvents ?? await db.select().from(events).where(and(eq(events.tenantId, this.tenantId), eq(events.triggerId, row.id), isNull(events.removedAt))).orderBy(events.position, events.createdAt, events.id);
      skillRows = loadedSkills?.filter(skill => skill.trigger_id === row.id) ?? (await db.execute(sql`SELECT s.id,s.key,s.revision,s.encrypted_body,s.encrypted_directory,s.artifact_version,js.position,js.context_skill FROM app.trigger_skills js JOIN app.skills s ON s.tenant_id=js.tenant_id AND s.id=js.skill_id WHERE js.tenant_id=${this.tenantId}::uuid AND js.trigger_id=${row.id}::uuid ORDER BY js.position`)).rows;
    }
    const skills = await Promise.all(skillRows.map(async skill => ({
      id:skill.id, key:skill.key, revision:skill.revision, position:skill.position, ...await this.content.read(skill, this.decrypt),
    })));
    const skill = skills[0]; // The unique relational selection is authoritative.
    return { id: row.id, requiresVm:row.executionConfig.requiresVm ?? (row.executionConfig.executionType==="code" || Boolean(row.executionConfig.connectionId)), runScopes: row.runScopes ?? [...DEFAULT_RUN_SCOPES], name: row.name, description: row.description ?? "", slug: row.slug, prompt: row.encryptedPrompt ? await this.decrypt(row.encryptedPrompt) : "", executionType: row.executionConfig.executionType ?? "agent", script: row.executionConfig.script, runNameTemplate: row.encryptedRunNameTemplate ? await (row.contextVersion<2 ? this.decryptTemplate(row.encryptedRunNameTemplate,eventRows) : this.decrypt(row.encryptedRunNameTemplate)) : "", tags: row.tags ?? [], model: row.model, ...(row.effort ? { effort: row.effort } : {}), executionConfig: row.executionConfig, portableIntegrationIds: row.executionConfig.portableIntegrationIds ?? [], modelAccess: row.executionConfig.modelAccess ?? "native", modelAccountId: row.executionConfig.modelAccountId, githubInstallationIds: row.executionConfig.githubInstallationIds ?? [], linearConnectionId: row.executionConfig.linearConnectionId, xConnectionIds: row.executionConfig.xConnectionIds ?? [], concurrencyLimit: row.concurrencyLimit, enabled: row.enabled, events: await Promise.all(eventRows.map(value => this.event(value,eventRows))), skill, contextReviewRequired:row.contextReviewRequired, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async getTrigger(id: string): Promise<Trigger | null> {
    const row = (await this.database.orm.select().from(triggers).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, id))).limit(1))[0];
    return row ? this.mapped(row) : null;
  }

  async list(): Promise<Trigger[]> {
    const rows = await this.database.orm.select().from(triggers).where(eq(triggers.tenantId, this.tenantId)).orderBy(sql`${triggers.createdAt} desc`);
    if (!rows.length) return [];
    const eventRows = await this.database.orm.select().from(events).where(and(eq(events.tenantId, this.tenantId), inArray(events.triggerId, rows.map(row => row.id)), isNull(events.removedAt))).orderBy(events.position, events.createdAt, events.id);
    const byTrigger = new Map<string, EventRow[]>();
    for (const event of eventRows) {
      const group = byTrigger.get(event.triggerId) ?? [];
      group.push(event);
      byTrigger.set(event.triggerId, group);
    }
    return Promise.all(rows.map(row => this.mapped(row, this.database.orm, byTrigger.get(row.id) ?? [], [])));
  }

  async create(trigger: Trigger, destinationTriggerIds: string[] = []): Promise<Trigger> {
    return this.database.orm.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}::text, 1))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}::text, 0))`);
      const [row] = await tx.insert(triggers).values({ tenantId: this.tenantId, id: trigger.id, name: trigger.name, description: trigger.description ?? "", slug: trigger.slug, encryptedPrompt: await this.encrypt(trigger.prompt), contextVersion:2, contextReviewRequired:trigger.contextReviewRequired ?? false, encryptedRunNameTemplate: trigger.runNameTemplate ? await this.encrypt(trigger.runNameTemplate) : "", executionConfig: trigger.executionConfig, runScopes: trigger.runScopes ?? [...DEFAULT_RUN_SCOPES], tags: trigger.tags ?? [], model: trigger.model, effort: trigger.effort ?? "", concurrencyLimit: trigger.concurrencyLimit, enabled: trigger.enabled, createdAt: new Date(trigger.createdAt), updatedAt: new Date(trigger.updatedAt) }).returning();
      if (destinationTriggerIds.length) await tx.insert(manualInvocationPermissions).values(destinationTriggerIds.map(destinationTriggerId => ({ tenantId: this.tenantId, sourceTriggerId: trigger.id, destinationTriggerId })));
      await this.reconcileEvents(tx, trigger, []);
      await this.reconcileSkills(tx, trigger, []);
      return this.mapped(row!, tx);
    });
  }

  async update(trigger: Trigger, expectedUpdatedAt?: string): Promise<Trigger> {
    return this.database.orm.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}::text, 1))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}::text, 0))`);
      const [current] = await tx.select().from(triggers).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, trigger.id))).for("update").limit(1);
      if (!current) throw new Error("Trigger not found");
      if (expectedUpdatedAt && current.updatedAt.toISOString() !== expectedUpdatedAt) throw new StaleTriggerEdit("Trigger changed since it was loaded");
      trigger = { ...trigger, updatedAt: new Date(Math.max(Date.parse(trigger.updatedAt), current.updatedAt.getTime() + 1)).toISOString() };
      const existing: EventRow[] = await tx.select().from(events).where(and(eq(events.tenantId, this.tenantId), eq(events.triggerId, trigger.id), isNull(events.removedAt))).orderBy(events.position);
      const [row] = await tx.update(triggers).set({ name: trigger.name, description: trigger.description ?? "", slug: trigger.slug, encryptedPrompt: await this.encrypt(trigger.prompt), contextVersion:2, contextReviewRequired:trigger.contextReviewRequired ?? false, encryptedRunNameTemplate: trigger.runNameTemplate ? await this.encrypt(trigger.runNameTemplate) : "", executionConfig: trigger.executionConfig, runScopes: trigger.runScopes ?? [...DEFAULT_RUN_SCOPES], tags: trigger.tags ?? [], model: trigger.model, effort: trigger.effort ?? "", concurrencyLimit: trigger.concurrencyLimit, enabled: trigger.enabled, updatedAt: new Date(trigger.updatedAt) }).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, trigger.id))).returning();
      await this.reconcileEvents(tx, trigger, existing);
      await this.reconcileSkills(tx, trigger, []);
      if (!trigger.contextReviewRequired) await tx.execute(sql`DELETE FROM app.configuration_diagnostics WHERE tenant_id=${this.tenantId}::uuid AND resource_id=${trigger.id}::uuid AND code='multiple_skills_require_review'`);
      await this.recordEdit(tx, trigger.id, trigger.updatedAt);
      return this.mapped(row!, tx);
    });
  }


  async setEnabled(id: string, enabled: boolean, changedAt: string): Promise<boolean> {
    return this.database.orm.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}::text, 1))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}::text, 0))`);
      if (enabled) {
        const [current]=await tx.select({review:triggers.contextReviewRequired}).from(triggers).where(and(eq(triggers.tenantId,this.tenantId),eq(triggers.id,id))).for("update").limit(1);
        if (current?.review) throw new ContextReviewRequired("Select one skill in Context before enabling this Trigger.");
      }
      const [trigger] = await tx.update(triggers).set({ enabled, updatedAt: sql`greatest(${new Date(changedAt)}::timestamptz, date_trunc('milliseconds', ${triggers.updatedAt}) + interval '1 millisecond')` }).where(and(eq(triggers.tenantId, this.tenantId), eq(triggers.id, id))).returning();
      if (!trigger) return false;
      const schedules: EventRow[] = await tx.select().from(events).where(and(eq(events.tenantId, this.tenantId), eq(events.triggerId, id), eq(events.kind, "schedule"), isNull(events.removedAt)));
      for (const event of schedules) await tx.update(scheduleState).set({ nextRunAt: enabled && event.enabled ? nextOccurrence(validateScheduleConfig(event.config), new Date()) : null }).where(and(eq(scheduleState.tenantId, this.tenantId), eq(scheduleState.eventId, event.id)));
      await this.recordEdit(tx, id, trigger.updatedAt.toISOString());
      return true;
    });
  }

  private async recordEdit(tx: any, sourceTriggerId: string, editedAt: string): Promise<void> {
    // Snapshot matching subscribers with the edit, so later subscriptions cannot
    // replay old edits. The outbox commits or rolls back with the trigger update.
    await tx.execute(sql`INSERT INTO app.trigger_edit_deliveries(tenant_id,delivery_id,event_id,source_trigger_id,edited_at)
      SELECT t.tenant_id,${crypto.randomUUID()}::uuid,t.id,${sourceTriggerId}::uuid,${editedAt}::timestamptz
      FROM app.events t JOIN app.triggers j ON j.tenant_id=t.tenant_id AND j.id=t.trigger_id
      WHERE t.tenant_id=${this.tenantId}::uuid AND t.trigger_id<>${sourceTriggerId}::uuid
        AND t.kind='triggerLifecycle' AND t.enabled AND t.removed_at IS NULL AND j.enabled
        AND t.config->'sourceTriggerIds' ? ${sourceTriggerId} AND t.config->'states' ? 'edited'`);
  }

  private async reconcileEvents(tx: any, trigger: Trigger, existing: EventRow[]): Promise<void> {
    const desiredIds = new Set(trigger.events.map(event => event.id));
    for (const old of existing.filter(event => !desiredIds.has(event.id))) {
      const referenced = await tx.select({ value: sql<number>`1` }).from(invocations).where(and(eq(invocations.tenantId, this.tenantId), eq(invocations.eventId, old.id))).limit(1)
        .then((rows: unknown[]) => rows.length > 0) || await tx.select({ value: sql<number>`1` }).from(lifecycleDeliveries).where(and(eq(lifecycleDeliveries.tenantId, this.tenantId), eq(lifecycleDeliveries.eventId, old.id))).limit(1).then((rows: unknown[]) => rows.length > 0)
        || await tx.select({ value: sql<number>`1` }).from(pendingVerifications).where(and(eq(pendingVerifications.tenantId, this.tenantId), eq(pendingVerifications.eventId, old.id))).limit(1).then((rows: unknown[]) => rows.length > 0);
      await tx.delete(triggerEditDeliveries).where(and(eq(triggerEditDeliveries.tenantId, this.tenantId), eq(triggerEditDeliveries.eventId, old.id)));
      if (referenced) await tx.update(events).set({ enabled: false, removedAt: new Date(trigger.updatedAt), updatedAt: new Date(trigger.updatedAt) }).where(and(eq(events.tenantId, this.tenantId), eq(events.id, old.id)));
      else await tx.delete(events).where(and(eq(events.tenantId, this.tenantId), eq(events.id, old.id)));
      await tx.delete(scheduleState).where(and(eq(scheduleState.tenantId, this.tenantId), eq(scheduleState.eventId, old.id)));
    }
    const existingById = new Map(existing.map(event => [event.id, event]));
    for (const [position, event] of trigger.events.entries()) {
      const old = existingById.get(event.id);
      if (old && old.kind !== event.kind) throw new Error("Event kind is immutable; replace the event with a new id");
      if (old) await tx.update(events).set({ slug: event.slug, enabled: event.enabled, config: event.config, encryptedTemplate:event.template===undefined ? null : await this.encrypt(event.template), legacyTemplate:false, position, updatedAt: new Date(event.updatedAt) }).where(and(eq(events.tenantId, this.tenantId), eq(events.id, event.id)));
      else await tx.insert(events).values({ tenantId: this.tenantId, id: event.id, triggerId: trigger.id, kind: event.kind, slug: event.slug, enabled: event.enabled, config: event.config, encryptedTemplate:event.template===undefined ? null : await this.encrypt(event.template), legacyTemplate:false, position, createdAt: new Date(event.createdAt), updatedAt: new Date(event.updatedAt) });
      if (event.kind === "schedule") {
        const next = trigger.enabled && event.enabled ? nextOccurrence(validateScheduleConfig(event.config), new Date()) : null;
        await tx.insert(scheduleState).values({ tenantId: this.tenantId, eventId: event.id, triggerId: trigger.id, nextRunAt: next }).onConflictDoUpdate({ target: [scheduleState.tenantId, scheduleState.eventId], set: { nextRunAt: next } });
      } else await tx.delete(scheduleState).where(and(eq(scheduleState.tenantId, this.tenantId), eq(scheduleState.eventId, event.id)));
    }
  }
  private async reconcileSkills(tx: any, trigger: Trigger, _existing: unknown[]): Promise<void> {
    const selected = trigger.skill ? [trigger.skill] : [];
    const ids = selected.map(skill => skill.id);
    if (new Set(ids).size !== ids.length) throw new Error("A skill may only be selected once per trigger");
    if (ids.length) {
      const found = await tx.execute(sql`SELECT id FROM app.skills WHERE tenant_id=${this.tenantId}::uuid AND id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) FOR SHARE`);
      if (found.rows.length !== ids.length) throw new Error("One or more selected skills are unavailable");
    }
    await tx.execute(sql`DELETE FROM app.trigger_skills WHERE tenant_id=${this.tenantId}::uuid AND trigger_id=${trigger.id}::uuid`);
    for (const [position, skill] of selected.entries()) await tx.execute(sql`INSERT INTO app.trigger_skills(tenant_id,trigger_id,skill_id,position,context_skill) VALUES(${this.tenantId}::uuid,${trigger.id}::uuid,${skill.id}::uuid,${position},false)`);
  }

  async delete(id: string): Promise<boolean> {
    return this.database.transaction(async client => {
      const result = await client.query("DELETE FROM app.triggers WHERE tenant_id=$1 AND id=$2 RETURNING id", [this.tenantId, id]);
      return result.rowCount === 1;
    });
  }
  async findInvocation(triggerId: string, claimKey: string) {
    const result = await this.database.pool.query<any>(`SELECT i.id invocation_id,i.trigger_id,i.source,i.claim_key,i.event_id,i.context,i.occurrence,i.source_trigger_id,i.source_run_id,i.created_at invocation_created_at,r.id run_id,r.state run_state,r.encrypted_prompt,r.encrypted_skill_snapshot,r.run_name,r.created_at run_created_at,r.updated_at run_updated_at,r.started_at
      FROM app.invocations i JOIN app.trigger_runs r ON r.tenant_id=i.tenant_id AND r.invocation_id=i.id WHERE i.tenant_id=$1 AND i.trigger_id=$2 AND i.claim_key=$3`, [this.tenantId, triggerId, claimKey]);
    const row = result.rows[0]; if (!row) return null;
    return { invocation: { id: row.invocation_id, triggerId: row.trigger_id, source: row.source, claimKey: row.claim_key, eventId: row.event_id, context: row.context, ...(row.source_trigger_id ? { sourceTriggerId: row.source_trigger_id } : {}), ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}), ...(row.occurrence ? { occurrence: row.occurrence } : {}), createdAt: row.invocation_created_at.toISOString() } as Invocation, run: { id: row.run_id, triggerId: row.trigger_id, invocationId: row.invocation_id, state: row.run_state, encryptedPrompt: row.encrypted_prompt, ...(row.encrypted_skill_snapshot ? { encryptedSkillSnapshot: row.encrypted_skill_snapshot } : {}), ...(row.run_name ? { runName: row.run_name } : {}), createdAt: row.run_created_at.toISOString(), updatedAt: row.run_updated_at.toISOString(), ...(row.started_at ? { startedAt: row.started_at.toISOString() } : {}) } as TriggerRun };
  }
  async insertInvocationAndRun(invocation: Invocation, run: TriggerRun): Promise<boolean> {
    return this.database.transaction(async client => {
      const concurrencyLimit = await lockTriggerQueue(client, this.tenantId, invocation.triggerId);
      const inserted = await client.query("INSERT INTO app.invocations(tenant_id,id,trigger_id,source,claim_key,event_id,context,occurrence,source_trigger_id,source_run_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id,trigger_id,claim_key) DO NOTHING", [this.tenantId, invocation.id, invocation.triggerId, invocation.source, invocation.claimKey, invocation.eventId, invocation.context, invocation.occurrence ?? null, invocation.sourceTriggerId ?? null, invocation.sourceRunId ?? null, invocation.createdAt]);
      if (!inserted.rowCount) return false;
      const trigger = (await client.query("SELECT slug, execution_config, model, effort, tags, run_scopes FROM app.triggers WHERE tenant_id=$1 AND id=$2", [this.tenantId, invocation.triggerId])).rows[0];
      run.state = await submitRun(client, this.tenantId, {
        id: run.id, triggerId: invocation.triggerId, invocationId: invocation.id, name: run.runName ?? "",
        source: invocation.source, claim: invocation.claimKey, encryptedPrompt: run.encryptedPrompt, encryptedSkills: run.encryptedSkillSnapshot,encryptedPromptPreview:run.encryptedPromptPreview,encryptedContextPrompt:run.encryptedContextPrompt,
        skill: run.skill, workspaceName: trigger.slug, triggerLimit: concurrencyLimit, createdAt: run.createdAt,
        config: {...trigger.execution_config, model: trigger.model, effort: trigger.effort, tags: trigger.tags, inputContext: invocation.context, runScopes: trigger.run_scopes},
      });
      return true;
    });
  }
  async countActiveRuns(triggerId: string): Promise<number> { return Number((await this.database.pool.query<{ count: string }>("SELECT count(*)::text count FROM app.trigger_runs WHERE tenant_id=$1 AND trigger_id=$2 AND state IN ('reserved','starting','running','blocked','stopping')", [this.tenantId, triggerId])).rows[0]?.count ?? 0); }
  async markRunRunning(runId: string, startedAt: string): Promise<TriggerRun> {
    const row = (await this.database.pool.query<any>("UPDATE app.trigger_runs SET state='running',started_at=$3,updated_at=$3 WHERE tenant_id=$1 AND id=$2 AND state='queued' RETURNING *", [this.tenantId, runId, startedAt])).rows[0];
    if (!row) throw new Error("Run is no longer queued");
    return { id: row.id, triggerId: row.trigger_id, invocationId: row.invocation_id, state: row.state, encryptedPrompt: row.encrypted_prompt, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), startedAt: row.started_at.toISOString() };
  }
}
