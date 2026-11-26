import { evaluateEnrichment, type Evaluation, type EnrichmentBudget } from "../event-enrichment";
import type { Env } from "../types";
import draft7 from "ajv/dist/refs/json-schema-draft-07.json";
import { validate } from "jsonschema";
import type { Database, DatabaseClient } from "./database";
import { enqueueMcpDeliveries, lockEventOutbox } from "./mcp-event-outbox";

export async function wakeMcpDeliveries(env: Pick<import("../types").Env, "SCHEDULER">) {
  if (!env.SCHEDULER) return;
  const alarm = env.SCHEDULER.get(env.SCHEDULER.idFromName("global"));
  const response = await alarm.fetch("https://scheduler/mcp-events", { method: "POST" });
  if (!response.ok) throw new Error("MCP event alarm wake failed");
  await response.body?.cancel();
}

export type MatchDecision = "matched" | "pending" | "excluded" | "failed";
export interface MatchInput {
  tenantId: string;
  triggerId: string;
  triggerRevision: number;
  sourceIdentity: string;
  deduplicationKey: string;
  evidence: Record<string, unknown>;
  decision: MatchDecision;
  pendingReason?: string;
  occurredAt?: string;
  githubSignal?: { minimumApprovals: number; requiredChecks: string[]; reviewerId?: string; reviewState?: string; reviewAt?: string; checkName?: string; checkConclusion?: string; checkAt?: string; deliveryId: string };
}
export interface MatchResult {
  matchId: string;
  outcome: MatchDecision;
  duplicate: boolean;
  pendingReason?: string;
  evaluationId?: string;
  occurrence: null | { id: string; definitionId: string; definitionRevision: number; occurredAt: string; payload: Record<string, unknown> };
}
// Event schemas are supplied at runtime. Workers cannot compile validators with eval.
const schemaOptions = { skipAttributes: ["format", "disallow", "extends"] };

export function validAgainstSchema(value: unknown, schema: object, path = "payload"): void {
  const schemaError = validate(schema, draft7, schemaOptions).errors[0];
  if (schemaError) throw new Error(`Invalid Event payload schema: ${schemaError.stack}`);

  const error = validate(value, schema, schemaOptions).errors[0];
  if (!error) return;
  const location = error.path.map(key => "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
  const message = error.name === "type" && Array.isArray(error.argument) && error.argument.length === 1
    ? `must be ${error.argument[0]}`
    : error.message;
  throw new Error(`${path}${location} ${message}`);
}

/**
 * The canonical internal match operation. Match state and any resulting
 * occurrence commit together. Opt-in enrichment reserves its deduplication
 * key durably before any upstream request; a cancelled match is never retried.
 */
export class EventMatchRepository {
  constructor(private database: Database, private wake?: () => Promise<void>, private env?: Env, private enrichmentBudget?: EnrichmentBudget) {}

  async match(input: MatchInput): Promise<MatchResult> {
    if (!input.tenantId || !input.triggerId || !input.sourceIdentity || !input.deduplicationKey) throw new Error("Tenant, trigger, source identity, and deduplication key are required");
    if (!Number.isSafeInteger(input.triggerRevision) || input.triggerRevision < 1) throw new Error("Trigger revision is invalid");
    if (!input.evidence || typeof input.evidence !== "object" || Array.isArray(input.evidence)) throw new Error("Normalized evidence must be an object");
    if (input.decision === "pending" && !input.pendingReason?.trim()) throw new Error("Pending matches need an inspectable reason");
    let enqueued = false;
    const result = await this.database.transaction(client => this.matchInTransaction(client, input, () => { enqueued = true; }));
    // The outbox is committed. A failed wake is recoverable by the alarm sweep.
    if (enqueued) await this.wake?.().catch(() => {});
    return result;
  }

  private async matchInTransaction(client: DatabaseClient, input: MatchInput, onEnqueued: () => void): Promise<MatchResult> {
    const trigger = (await client.query<any>(`SELECT enabled,revision,event_definition_id,input_mapping
      FROM app.triggers WHERE tenant_id=$1 AND id=$2 FOR SHARE`, [input.tenantId, input.triggerId])).rows[0];
    if (!trigger) throw new Error("Trigger not found");
    if (!trigger.enabled) throw new Error("Trigger is disabled");
    if (trigger.revision !== input.triggerRevision) throw new Error("Trigger revision changed during matching");
    const definition = (await client.query<any>(`SELECT d.name,d.description,d.current_revision,r.payload_schema,r.enrichment,r.evaluator_authority
      FROM app.event_definitions d JOIN app.event_definition_revisions r
        ON r.tenant_id=d.tenant_id AND r.definition_id=d.id AND r.revision=d.current_revision
      WHERE d.tenant_id=$1 AND d.id=$2 FOR SHARE OF d,r`, [input.tenantId, trigger.event_definition_id])).rows[0];
    if (!definition) throw new Error("Trigger output definition is unavailable");

    const id = crypto.randomUUID(), now = new Date().toISOString();
    let evidence = input.evidence;
    let decision = input.decision;
    let pendingReason = input.pendingReason;
    if (definition.enrichment || input.githubSignal) {
      const lockKey = `${input.tenantId}:${input.triggerId}:${input.triggerRevision}:${input.sourceIdentity}:${input.deduplicationKey}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);
    }
    if (input.githubSignal) {
      const prior = (await client.query<any>(`SELECT evidence,outcome,occurrence_id FROM app.trigger_matches
        WHERE tenant_id=$1 AND trigger_id=$2 AND trigger_revision=$3 AND source_identity=$4 AND deduplication_key=$5 FOR UPDATE`,
      [input.tenantId,input.triggerId,input.triggerRevision,input.sourceIdentity,input.deduplicationKey])).rows[0];
      const priorEvidence = prior?.evidence ?? {};
      const reviews = { ...(priorEvidence.reviews ?? {}) } as Record<string, any>;
      const checks = { ...(priorEvidence.checks ?? {}) } as Record<string, any>;
      const deliveries = new Set<string>(priorEvidence.contributing_delivery_ids ?? []);
      deliveries.add(input.githubSignal.deliveryId);
      if (input.githubSignal.reviewerId) {
        const old = reviews[input.githubSignal.reviewerId];
        if (!old || (input.githubSignal.reviewAt ?? "") >= old.at) reviews[input.githubSignal.reviewerId] = { state: input.githubSignal.reviewState, at: input.githubSignal.reviewAt ?? "" };
      }
      if (input.githubSignal.checkName) {
        const old = checks[input.githubSignal.checkName];
        if (!old || (input.githubSignal.checkAt ?? "") >= old.at) checks[input.githubSignal.checkName] = { conclusion: input.githubSignal.checkConclusion, at: input.githubSignal.checkAt ?? "" };
      }
      const approvals = Object.values(reviews).filter((review: any) => String(review.state).toLowerCase() === "approved").length;
      const missingChecks = input.githubSignal.requiredChecks.filter(name => String(checks[name]?.conclusion).toLowerCase() !== "success");
      const reasons = [approvals < input.githubSignal.minimumApprovals ? `Waiting for ${input.githubSignal.minimumApprovals-approvals} approved review(s).` : "", missingChecks.length ? `Waiting for successful checks: ${missingChecks.join(", ")}.` : ""].filter(Boolean);
      evidence = { ...priorEvidence, ...input.evidence, reviews, checks, contributing_delivery_ids: [...deliveries], evaluation: { approvals, required_approvals: input.githubSignal.minimumApprovals, missing_checks: missingChecks } };
      decision = prior?.outcome === "matched" ? "matched" : reasons.length ? "pending" : "matched";
      pendingReason = decision === "pending" ? reasons.join(" ") : undefined;
    }
    let evaluationId: string | undefined;
    if (definition.enrichment && decision === "matched") {
      const prior = (await client.query<any>(`SELECT id,outcome,occurrence_id,pending_reason FROM app.trigger_matches
        WHERE tenant_id=$1 AND trigger_id=$2 AND trigger_revision=$3 AND source_identity=$4 AND deduplication_key=$5 AND outcome<>'pending'`,
        [input.tenantId,input.triggerId,input.triggerRevision,input.sourceIdentity,input.deduplicationKey])).rows[0];
      const reservationPool = this.database.pool;
      const key = JSON.stringify([input.sourceIdentity,input.deduplicationKey]);
      if (prior) {
        const run = (await reservationPool.query<{id:string}>(`SELECT id FROM app.event_enrichment_runs
          WHERE tenant_id=$1 AND trigger_id=$2 AND dedup_digest=encode(sha256(convert_to($3,'UTF8')),'hex')`,
          [input.tenantId,input.triggerId,key])).rows[0];
        return { ...await this.resultForSaved(client,input.tenantId,prior,true), ...(run ? {evaluationId:run.id} : {}) };
      }
      const reserved = crypto.randomUUID();
      // Commit the reservation before network IO, independently of the main
      // match transaction. A crash after dispatch can never cause a retry.
      const reservation = await reservationPool.query(`INSERT INTO app.event_enrichment_runs(tenant_id,definition_id,trigger_id,dedup_digest,id,state)
        VALUES($1,$2,$3,encode(sha256(convert_to($4,'UTF8')),'hex'),$5,'running')
        ON CONFLICT (tenant_id,trigger_id,dedup_digest) DO NOTHING RETURNING id`,
        [input.tenantId,trigger.event_definition_id,input.triggerId,key,reserved]);
      if (!reservation.rowCount) {
        const run = (await reservationPool.query<{id:string}>(`SELECT id FROM app.event_enrichment_runs
          WHERE tenant_id=$1 AND trigger_id=$2 AND dedup_digest=encode(sha256(convert_to($3,'UTF8')),'hex')`,
          [input.tenantId,input.triggerId,key])).rows[0];
        return { matchId: id, outcome:"failed", duplicate:true, occurrence:null, ...(run ? {evaluationId:run.id} : {}) };
      }
      evaluationId = reserved;
      let evaluated: Evaluation;
      try {
        const time = this.enrichmentBudget?.take(definition.enrichment.extraDataUrls.length) ?? 8000;
        evaluated = !time ? {state:"failed",stage:"evaluation",reason:"evaluation_budget_exhausted",steps:[]}
          : this.env && definition.evaluator_authority
            ? await evaluateEnrichment(this.env,input.tenantId,definition.enrichment,definition.evaluator_authority,trigger.input_mapping,evidence,time)
            : {state:"failed",stage:"authority",reason:"authority_unavailable",steps:[]};
        if (evaluated.state === "matched") {
          try { validAgainstSchema(evaluated.input,definition.payload_schema); }
          catch { evaluated = {...evaluated,state:"failed",stage:"payload",reason:"payload_schema_invalid"}; }
        }
      } catch { evaluated = {state:"failed",stage:"evaluation",reason:"evaluation_unavailable",steps:[]}; }
      await client.query(`UPDATE app.event_enrichment_runs SET state=$3,stage=$4,reason=$5,steps=$6,normalized_input=$7
        WHERE tenant_id=$1 AND id=$2`,[input.tenantId,reserved,evaluated.state,evaluated.stage,evaluated.reason,
        JSON.stringify(evaluated.steps),evaluated.input ?? null]);
      decision = evaluated.state;
      evidence = evaluated.input ?? {};
    }
    const evaluation = evaluationId ? { evaluationId } : {};
    const inserted = await client.query<any>(`INSERT INTO app.trigger_matches
      (tenant_id,id,trigger_id,trigger_revision,source_identity,deduplication_key,evidence,outcome,pending_reason,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
      ON CONFLICT(tenant_id,trigger_id,trigger_revision,source_identity,deduplication_key) DO UPDATE
        SET evidence=excluded.evidence,outcome=excluded.outcome,pending_reason=excluded.pending_reason,updated_at=excluded.updated_at
        WHERE app.trigger_matches.outcome='pending'
      RETURNING id`,
    [input.tenantId, id, input.triggerId, input.triggerRevision, input.sourceIdentity, input.deduplicationKey, evidence, decision, decision === "pending" ? pendingReason : null, now]);
    const saved = (await client.query<any>(`SELECT id,outcome,pending_reason,occurrence_id FROM app.trigger_matches
      WHERE tenant_id=$1 AND trigger_id=$2 AND trigger_revision=$3 AND source_identity=$4 AND deduplication_key=$5 FOR UPDATE`,
    [input.tenantId, input.triggerId, input.triggerRevision, input.sourceIdentity, input.deduplicationKey])).rows[0];
    if (!inserted.rowCount) return this.resultForSaved(client, input.tenantId, saved, true);

    if (decision !== "matched") return { ...evaluation, matchId: saved.id, outcome: decision, duplicate: false, ...(pendingReason ? { pendingReason } : {}), occurrence: null };
    if (saved.occurrence_id) return this.resultForSaved(client,input.tenantId,saved,true);
    const payload = evidence;
    validAgainstSchema(payload, definition.payload_schema);
    const occurrenceId = crypto.randomUUID(), occurredAt = input.occurredAt ?? now;
    await lockEventOutbox(client, input.tenantId, trigger.event_definition_id);
    const occurrenceWrite = await client.query(`INSERT INTO app.event_occurrences
      (tenant_id,id,definition_id,definition_revision,occurred_at,payload,producer_identity,evidence,source_identity,idempotency_key,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())
      ON CONFLICT(tenant_id,definition_id,source_identity,idempotency_key) DO NOTHING RETURNING id`,
    [input.tenantId, occurrenceId, trigger.event_definition_id, definition.current_revision, occurredAt, payload,
      { kind: "trigger", id: input.triggerId, revision: input.triggerRevision }, JSON.stringify([evidence]), input.sourceIdentity, input.deduplicationKey]);
    if (occurrenceWrite.rowCount && await enqueueMcpDeliveries(client, input.tenantId, trigger.event_definition_id, occurrenceId)) onEnqueued();
    const occurrence = (await client.query<any>(`SELECT id,definition_id,definition_revision,occurred_at,payload
      FROM app.event_occurrences WHERE tenant_id=$1 AND definition_id=$2 AND source_identity=$3 AND idempotency_key=$4`,
    [input.tenantId, trigger.event_definition_id, input.sourceIdentity, input.deduplicationKey])).rows[0];
    await client.query("UPDATE app.trigger_matches SET occurrence_id=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2", [input.tenantId, saved.id, occurrence.id, now]);
    return { ...evaluation, matchId: saved.id, outcome: "matched", duplicate: !occurrenceWrite.rowCount, occurrence: { id: occurrence.id, definitionId: occurrence.definition_id, definitionRevision: occurrence.definition_revision, occurredAt: occurrence.occurred_at.toISOString(), payload: occurrence.payload } };
  }

  private async resultForSaved(client: DatabaseClient, tenantId: string, row: any, duplicate: boolean): Promise<MatchResult> {
    if (!row) throw new Error("Trigger match was not persisted");
    if (!row.occurrence_id) return { matchId: row.id, outcome: row.outcome, duplicate, ...(row.pending_reason ? { pendingReason: row.pending_reason } : {}), occurrence: null };
    const occurrence = (await client.query<any>(`SELECT id,definition_id,definition_revision,occurred_at,payload FROM app.event_occurrences WHERE tenant_id=$1 AND id=$2`, [tenantId, row.occurrence_id])).rows[0];
    if (!occurrence) throw new Error("Trigger match references a missing occurrence");
    return { matchId: row.id, outcome: row.outcome, duplicate, occurrence: { id: occurrence.id, definitionId: occurrence.definition_id, definitionRevision: occurrence.definition_revision, occurredAt: occurrence.occurred_at.toISOString(), payload: occurrence.payload } };
  }
}
