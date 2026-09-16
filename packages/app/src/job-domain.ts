import Mustache from "mustache";

export type TriggerKind = "manual" | "schedule" | "webhook";
export type InvocationSource = TriggerKind;
export type JobRunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

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
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  name: string;
  promptTemplate: string;
  parameterDefaults: Record<string, string>;
  executionTarget: ExecutionTarget;
  concurrencyLimit: number;
  enabled: boolean;
  trigger: Trigger;
  createdAt: string;
  updatedAt: string;
}

export interface InvocationRequest {
  source: InvocationSource;
  context?: string;
  parameters?: Record<string, string>;
  /** Stable, source-owned key used to claim this occurrence exactly once. */
  claimKey: string;
  occurrence?: { occurredAt?: string; externalId?: string; metadata?: Record<string, unknown> };
}

export interface Invocation {
  id: string;
  jobId: string;
  source: InvocationSource;
  claimKey: string;
  context?: string;
  parameters: Record<string, string>;
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

const recordOfStrings = (value: unknown, name: string): Record<string, string> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string")) {
    throw new InvocationError("invalid_invocation", `${name} must contain only string values.`);
  }
  return value as Record<string, string>;
};

export function renderJobPrompt(job: Pick<Job, "promptTemplate" | "parameterDefaults">, request: Pick<InvocationRequest, "context" | "parameters">): string {
  const defaults = recordOfStrings(job.parameterDefaults, "Job parameter defaults");
  if (Object.prototype.hasOwnProperty.call(defaults, "context")) throw new InvocationError("invalid_template", "context is reserved and cannot be a job parameter.");
  const overrides = recordOfStrings(request.parameters, "Invocation parameters");
  if (Object.prototype.hasOwnProperty.call(overrides, "context")) throw new InvocationError("invalid_invocation", "context is reserved and must be supplied through the context field.");
  try {
    Mustache.parse(job.promptTemplate);
    return Mustache.render(job.promptTemplate, { ...defaults, ...overrides, context: request.context ?? "" });
  } catch (error) {
    if (error instanceof InvocationError) throw error;
    throw new InvocationError("invalid_template", "The job prompt is not valid Mustache.");
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
    if (!(["manual", "schedule", "webhook"] as const).includes(input.source)) throw new InvocationError("invalid_invocation", "Invocation source is invalid.");
    const job = await this.repository.getJob(jobId);
    if (!job) throw new InvocationError("job_not_found", "Job not found.");
    if (!job.enabled) throw new InvocationError("job_disabled", "Job is disabled.");

    const existing = await this.repository.findInvocation(jobId, input.claimKey);
    if (existing) return { ...existing, duplicate: true };

    const parameters = recordOfStrings(input.parameters, "Invocation parameters");
    const createdAt = this.clock();
    const invocation: Invocation = { id: this.makeId(), jobId, source: input.source, claimKey: input.claimKey, ...(input.context === undefined ? {} : { context: input.context }), parameters, ...(input.occurrence ? { occurrence: input.occurrence } : {}), createdAt };
    const run: JobRun = { id: this.makeId(), jobId, invocationId: invocation.id, state: "queued", encryptedPrompt: await this.encryptPrompt(renderJobPrompt(job, input)), createdAt, updatedAt: createdAt };
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
    id TEXT PRIMARY KEY, name TEXT NOT NULL, encrypted_prompt_template TEXT NOT NULL,
    parameter_defaults TEXT NOT NULL, execution_target TEXT NOT NULL,
    concurrency_limit INTEGER NOT NULL CHECK (concurrency_limit >= 1), enabled INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('manual','schedule','webhook')), config TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invocations (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('manual','schedule','webhook')), claim_key TEXT NOT NULL,
    context TEXT, parameters TEXT NOT NULL, occurrence TEXT, created_at TEXT NOT NULL,
    UNIQUE(job_id, claim_key)
  );
  CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    invocation_id TEXT NOT NULL UNIQUE REFERENCES invocations(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
    encrypted_prompt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT
  );
  CREATE INDEX IF NOT EXISTS job_runs_queue ON job_runs(state, created_at);
  CREATE INDEX IF NOT EXISTS job_runs_active ON job_runs(job_id, state);
  CREATE TABLE IF NOT EXISTS schedule_state (
    trigger_id TEXT PRIMARY KEY REFERENCES triggers(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    next_run_at INTEGER, last_triggered_at TEXT
  );
  CREATE INDEX IF NOT EXISTS schedules_due ON schedule_state(next_run_at);
`;
