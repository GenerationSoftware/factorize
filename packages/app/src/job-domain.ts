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
  runName?: string;
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
    const run: JobRun = { id: this.makeId(), jobId, invocationId: invocation.id, state: "queued", encryptedPrompt: await this.encryptPrompt(renderJobPrompt(job, input.context)), runName: renderRunName(job.runNameTemplate ?? "", input.context, job.name), createdAt, updatedAt: createdAt };
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
