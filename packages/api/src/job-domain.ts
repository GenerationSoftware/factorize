import {runPromptPreview} from "./run-prompt";
import Mustache from "mustache";
import { renderTextTemplate } from "./text-template";

export type EventKind = "manual" | "schedule" | "webhook" | "triggerLifecycle" | "triggerIdle";
export type InvocationSource = "manual" | EventKind;
export type TriggerRunState = "queued" | "reserved" | "running" | "succeeded" | "failed" | "stopped";

export interface ExecutionConfig {
  executionType?: "agent" | "code";
  requiresVm?:boolean;
  skillId?: string;
  targetId?: string;
  connectionId: string;
  workspace: string;
  cwd: string;
  agentKind: string;
  tags?: string[];
  image?: string;
  script?: string;
  portableIntegrationIds?: string[];
  modelAccess?: "native" | "portable";
  modelAccountId?: string;
  githubInstallationIds?: number[];
  linearConnectionId?: "linear" | null;
  xConnectionIds?: string[];
  executionProvider?: "exe" | "fly" | "docker";
  region?: string;
  size?: string;
}

export interface Event {
  id: string;
  triggerId: string;
  kind: EventKind;
  slug: string;
  enabled: boolean;
  config: Record<string, unknown>;
  template?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerSkill { version?: import("./skill-files").SkillVersion; id: string; key: string; revision: number; body: string; position: number }

export interface Trigger {
  id: string;
  name: string;
  description?: string;
  slug: string;
  prompt: string;
  executionType?: "agent" | "code";
  requiresVm?:boolean;
  script?: string;
  runNameTemplate?: string;
  model: string;
  effort?: string;
  tags?: string[];
  executionConfig: ExecutionConfig;
  runScopes?: string[];
  concurrencyLimit: number;
  enabled: boolean;
  events: Event[];
  createdAt: string;
  updatedAt: string;
  skill?: TriggerSkill;
  contextReviewRequired?: boolean;
  portableIntegrationIds?: string[];
  modelAccess?: "native" | "portable";
  modelAccountId?: string;
  githubInstallationIds?: number[];
  linearConnectionId?: "linear" | null;
  xConnectionIds?: string[];
}

export interface InvocationRequest {
  source: InvocationSource;
  /** Optional display name for a manual run; takes precedence over the template. */
  name?: string;
  eventId: string;
  context: Record<string, unknown>;
  /** Stable, source-owned key used to claim this occurrence exactly once. */
  claimKey: string;
  sourceTriggerId?: string;
  sourceRunId?: string;
  occurrence?: { occurredAt?: string; externalId?: string; metadata?: Record<string, unknown> };
}

export interface Invocation {
  id: string;
  triggerId: string;
  source: InvocationSource;
  claimKey: string;
  eventId: string;
  context: Record<string, unknown>;
  sourceTriggerId?: string;
  sourceRunId?: string;
  occurrence?: InvocationRequest["occurrence"];
  createdAt: string;
}

export interface TriggerRun {
  id: string;
  triggerId: string;
  invocationId: string;
  state: TriggerRunState;
  /** Persisted form is encrypted; repositories decrypt only at an authorized read boundary. */
  encryptedPrompt: string;
  encryptedPromptPreview?:string;
  encryptedContextPrompt?:string;
  skill?: { id: string; key: string; revision: number };
  encryptedSkillSnapshot?: string;
  runName?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
}

export interface InvocationResult { invocation: Invocation; run: TriggerRun; duplicate: boolean; }

export interface TriggerRepository {
  getTrigger(id: string): Promise<Trigger | null>;
  findInvocation(triggerId: string, claimKey: string): Promise<{ invocation: Invocation; run: TriggerRun } | null>;
  /** Atomically reserve a free slot, retaining at most one waiting run. */
  insertInvocationAndRun(invocation: Invocation, run: TriggerRun): Promise<boolean>;
  countActiveRuns(triggerId: string): Promise<number>;
  markRunRunning(runId: string, startedAt: string): Promise<TriggerRun>;
}

export class InvocationError extends Error {
  constructor(public code: "queue_full" | "trigger_not_found" | "trigger_disabled" | "invalid_invocation" | "invalid_template", message: string) { super(message); }
}

function promptSkills(trigger: Pick<Trigger, "skill">): TriggerSkill[] {
  return trigger.skill ? [trigger.skill] : [];
}

export function eventRenderingContext(trigger: Pick<Trigger,"events">, context: Record<string,unknown>, eventId?:string) {
  const event=trigger.events.find(event => event.id===eventId) ?? (!eventId ? trigger.events.find(event => Object.hasOwn(context,event.slug)) : undefined);
  const data=event ? context[event.slug] : undefined;
  const fields=data && typeof data==="object" && !Array.isArray(data) ? data as Record<string,unknown> : {};
  return {event,fields,values:{...fields,...context,...(event?.kind==="webhook" ? {webhook:fields} : {})}};
}

export function composeTriggerContext(prompt:string, template:string|undefined, eventData:Record<string,unknown>, instructions="", skill?:{body:string}) {
  try {
    const eventText=template ? renderTextTemplate(template,eventData) : "";
    return {eventText,prompt:[skill?.body ?? "",prompt,eventText,instructions].filter(text=>text.trim()).join("\n\n")};
  } catch {
    throw new InvocationError("invalid_template","The Event template is not valid Mustache.");
  }
}

export function renderTriggerPrompt(trigger: Pick<Trigger,"prompt"|"skill"|"events">, context:Record<string,unknown>, eventId?:string, instructions?:string):string {
  const {event,fields,values}=eventRenderingContext(trigger,context,eventId);
  const caller=instructions ?? (event?.kind==="manual" && typeof fields.prompt==="string" ? fields.prompt : "");
  return composeTriggerContext(trigger.prompt,event?.template,values,caller,trigger.skill).prompt;
}

export function renderRunName(template: string, context: Record<string, unknown>, fallback: string): string {
  if (!template.trim()) return fallback;
  try {
    Mustache.parse(template);
    const name = renderTextTemplate(template, context).trim();
    return name || fallback;
  } catch {
    return fallback;
  }
}

/** The only operation event adapters call after normalizing an occurrence. */
export class InvocationService {
  constructor(
    private repository: TriggerRepository,
    private encryptPrompt: (prompt: string) => Promise<string>,
    private makeId: () => string = () => crypto.randomUUID(),
    private clock: () => string = () => new Date().toISOString(),
    private encryptSnapshot: (snapshot: string) => Promise<string> = encryptPrompt,
  ) {}

  async invoke(triggerId: string, input: InvocationRequest): Promise<InvocationResult> {
    if (!input.claimKey?.trim()) throw new InvocationError("invalid_invocation", "An invocation claim key is required.");
    if (!(["manual", "schedule", "webhook", "triggerLifecycle", "triggerIdle"] as const).includes(input.source)) throw new InvocationError("invalid_invocation", "Invocation source is invalid.");
    const trigger = await this.repository.getTrigger(triggerId);
    if (!trigger) throw new InvocationError("trigger_not_found", "Trigger not found.");
    if (!trigger.enabled) throw new InvocationError("trigger_disabled", "Trigger is disabled.");

    const existing = await this.repository.findInvocation(triggerId, input.claimKey);
    if (existing) return { ...existing, duplicate: true };

    if (!input.eventId || !input.context || typeof input.context !== "object" || Array.isArray(input.context)) throw new InvocationError("invalid_invocation", "A event and structured context are required.");
    const createdAt = this.clock();
    const invocation: Invocation = { id: this.makeId(), triggerId, source: input.source, claimKey: input.claimKey, eventId: input.eventId, context: input.context, ...(input.sourceTriggerId ? { sourceTriggerId: input.sourceTriggerId } : {}), ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}), ...(input.occurrence ? { occurrence: input.occurrence } : {}), createdAt };
    const selectedSkills = promptSkills(trigger);
    const event=trigger.events.find(event=>event.id===input.eventId);
    if (!event || !event.enabled) throw new InvocationError("invalid_invocation","The Event is missing or disabled.");
    const effectivePrompt=renderTriggerPrompt(trigger,input.context,input.eventId,input.source === "manual" ? undefined : "");
    if (trigger.executionType !== "code" && !trigger.skill && !effectivePrompt.trim()) throw new InvocationError("invalid_invocation","Choose a skill or provide a prompt, Event template, or manual instructions before starting a run.");
    const contextPrompt=trigger.executionType==="code"?trigger.script??"":renderTriggerPrompt({...trigger,skill:undefined},input.context,input.eventId,input.source==="manual"?undefined:"");
    const run: TriggerRun = { id: this.makeId(), triggerId, invocationId: invocation.id, state: "queued", skill: trigger.skill, encryptedPrompt: await this.encryptPrompt(effectivePrompt),encryptedPromptPreview:await this.encryptPrompt(runPromptPreview(contextPrompt)),encryptedContextPrompt:await this.encryptPrompt(contextPrompt), encryptedSkillSnapshot: selectedSkills.length ? await this.encryptSnapshot(JSON.stringify(selectedSkills.map((skill,order) => ({ id: skill.id, key: skill.key, revision: skill.revision, body: skill.body, version: skill.version, order })))) : undefined, runName: (input.source === "manual" ? input.name?.trim() : undefined) || renderRunName(trigger.runNameTemplate ?? "", eventRenderingContext(trigger,input.context,input.eventId).values, trigger.name), createdAt, updatedAt: createdAt };
    if (!await this.repository.insertInvocationAndRun(invocation, run)) {
      const winner = await this.repository.findInvocation(triggerId, input.claimKey);
      if (!winner) throw new Error("Invocation claim was lost without a persisted winner.");
      return { ...winner, duplicate: true };
    }
    return { invocation, run, duplicate: false };
  }

  async startIfCapacity(run: TriggerRun): Promise<TriggerRun | null> {
    const trigger = await this.repository.getTrigger(run.triggerId);
    if (!trigger || !trigger.enabled || run.state !== "queued") return null;
    if (await this.repository.countActiveRuns(trigger.id) >= trigger.concurrencyLimit) return null;
    return this.repository.markRunRunning(run.id, this.clock());
  }
}
