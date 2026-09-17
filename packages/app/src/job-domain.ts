import Mustache from "mustache";

export type TriggerKind = "manual" | "schedule" | "webhook" | "jobLifecycle";
export type InvocationSource = "manual" | TriggerKind;
export type JobRunState = "queued" | "running" | "succeeded" | "failed" | "stopped";

export interface ExecutionTarget {
  connectionId: string;
  workspace: string;
  cwd: string;
  agentKind: string;
}

export interface Trigger {
  id: string;
  jobId: string;
  kind: TriggerKind;
  slug: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  name: string;
  slug: string;
  promptTemplate: string;
  runNameTemplate?: string;
  model: string;
  effort?: string;
  executionTarget: ExecutionTarget;
  concurrencyLimit: number;
  enabled: boolean;
  triggers: Trigger[];
  createdAt: string;
  updatedAt: string;
}

export interface InvocationRequest {
  source: InvocationSource;
  triggerId: string;
  context: Record<string, unknown>;
  /** Stable, source-owned key used to claim this occurrence exactly once. */
  claimKey: string;
  occurrence?: { occurredAt?: string; externalId?: string; metadata?: Record<string, unknown> };
}

export interface Invocation {
  id: string;
  jobId: string;
  source: InvocationSource;
  claimKey: string;
  triggerId: string;
  context: Record<string, unknown>;
  occurrence?: InvocationRequest["occurrence"];
  createdAt: string;
}

export interface JobRun {
  id: string;
  jobId: string;
  invocationId: string;
  state: JobRunState;
  /** Persisted form is encrypted; repositories decrypt only at an authorized read boundary. */
  encryptedPrompt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
}

export interface InvocationResult { invocation: Invocation; run: JobRun; duplicate: boolean; }

export interface JobRepository {
  getJob(id: string): Promise<Job | null>;
  findInvocation(jobId: string, claimKey: string): Promise<{ invocation: Invocation; run: JobRun } | null>;
  insertInvocationAndRun(invocation: Invocation, run: JobRun): Promise<boolean>;
  countActiveRuns(jobId: string): Promise<number>;
  markRunRunning(runId: string, startedAt: string): Promise<JobRun>;
}

export class InvocationError extends Error {
  constructor(public code: "job_not_found" | "job_disabled" | "invalid_invocation" | "invalid_template", message: string) { super(message); }
}

export function renderJobPrompt(job: Pick<Job, "promptTemplate">, context: Record<string, unknown>): string {
  try {
    Mustache.parse(job.promptTemplate);
    return Mustache.render(job.promptTemplate, context);
  } catch (error) {
    if (error instanceof InvocationError) throw error;
    throw new InvocationError("invalid_template", "The job prompt is not valid Mustache.");
  }
}

export function renderRunName(template: string, context: Record<string, unknown>, fallback: string): string {
  if (!template.trim()) return fallback;
  try {
    Mustache.parse(template);
    const name = Mustache.render(template, context).trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

/** The only operation trigger adapters call after normalizing an occurrence. */
export class InvocationService {
  constructor(
    private repository: JobRepository,
    private encryptPrompt: (prompt: string) => Promise<string>,
    private makeId: () => string = () => crypto.randomUUID(),
    private clock: () => string = () => new Date().toISOString(),
  ) {}

  async invoke(jobId: string, input: InvocationRequest): Promise<InvocationResult> {
    if (!input.claimKey?.trim()) throw new InvocationError("invalid_invocation", "An invocation claim key is required.");
    if (!(["manual", "schedule", "webhook", "jobLifecycle"] as const).includes(input.source)) throw new InvocationError("invalid_invocation", "Invocation source is invalid.");
    const job = await this.repository.getJob(jobId);
    if (!job) throw new InvocationError("job_not_found", "Job not found.");
    if (!job.enabled) throw new InvocationError("job_disabled", "Job is disabled.");

    const existing = await this.repository.findInvocation(jobId, input.claimKey);
    if (existing) return { ...existing, duplicate: true };

    if (!input.triggerId || !input.context || typeof input.context !== "object" || Array.isArray(input.context)) throw new InvocationError("invalid_invocation", "A trigger and structured context are required.");
    const createdAt = this.clock();
    const invocation: Invocation = { id: this.makeId(), jobId, source: input.source, claimKey: input.claimKey, triggerId: input.triggerId, context: input.context, ...(input.occurrence ? { occurrence: input.occurrence } : {}), createdAt };
    const run: JobRun = { id: this.makeId(), jobId, invocationId: invocation.id, state: "queued", encryptedPrompt: await this.encryptPrompt(renderJobPrompt(job, input.context)), createdAt, updatedAt: createdAt };
    if (!await this.repository.insertInvocationAndRun(invocation, run)) {
      const winner = await this.repository.findInvocation(jobId, input.claimKey);
      if (!winner) throw new Error("Invocation claim was lost without a persisted winner.");
      return { ...winner, duplicate: true };
    }
    return { invocation, run, duplicate: false };
  }

  async startIfCapacity(run: JobRun): Promise<JobRun | null> {
    const job = await this.repository.getJob(run.jobId);
    if (!job || !job.enabled || run.state !== "queued") return null;
    if (await this.repository.countActiveRuns(job.id) >= job.concurrencyLimit) return null;
    return this.repository.markRunRunning(run.id, this.clock());
  }
}

/** Fresh v2 Durable Object schema. There are deliberately no legacy Flow migrations. */
export const JOB_SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, encrypted_prompt_template TEXT NOT NULL, encrypted_run_name_template TEXT NOT NULL DEFAULT '',
    execution_target TEXT NOT NULL,
    concurrency_limit INTEGER NOT NULL CHECK (concurrency_limit >= 1), enabled INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('manual','schedule','webhook','jobLifecycle')), slug TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, config TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(job_id, slug)
  );
  CREATE TABLE IF NOT EXISTS invocations (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('manual','schedule','webhook','jobLifecycle')), claim_key TEXT NOT NULL,
    trigger_id TEXT NOT NULL, context TEXT NOT NULL, occurrence TEXT, created_at TEXT NOT NULL,
    UNIQUE(job_id, claim_key)
  );
  CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    invocation_id TEXT NOT NULL UNIQUE REFERENCES invocations(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','stopped')),
    encrypted_prompt TEXT NOT NULL, run_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT
  );
  CREATE INDEX IF NOT EXISTS job_runs_queue ON job_runs(state, created_at);
  CREATE INDEX IF NOT EXISTS job_runs_active ON job_runs(job_id, state);
  CREATE TABLE IF NOT EXISTS job_events (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, delivery_id TEXT NOT NULL, outcome TEXT NOT NULL,
    detail TEXT NOT NULL, received_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS job_events_by_job ON job_events(job_id, received_at DESC);
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, delivery_id TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'unknown',
    event_action TEXT NOT NULL DEFAULT 'unknown', outcome TEXT NOT NULL, detail TEXT NOT NULL, received_at TEXT NOT NULL,
    UNIQUE(provider, delivery_id)
  );
  CREATE TABLE IF NOT EXISTS webhook_delivery_events (
    id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
    job_id TEXT, outcome TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS webhook_deliveries_order ON webhook_deliveries(received_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS webhook_deliveries_provider ON webhook_deliveries(provider, received_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS webhook_deliveries_outcome ON webhook_deliveries(outcome, received_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS webhook_delivery_events_delivery ON webhook_delivery_events(delivery_id, created_at, id);
  CREATE TABLE IF NOT EXISTS schedule_state (
    trigger_id TEXT PRIMARY KEY REFERENCES triggers(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    next_run_at INTEGER, last_triggered_at TEXT
  );
  CREATE INDEX IF NOT EXISTS schedules_due ON schedule_state(next_run_at);
  CREATE TABLE IF NOT EXISTS automatic_wakes (
    job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    trailing INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lifecycle_deliveries (
    trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
    source_run_id TEXT NOT NULL, terminal_state TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(trigger_id,source_run_id,terminal_state)
  );
`;
