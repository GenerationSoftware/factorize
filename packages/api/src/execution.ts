import type { TraceSource, TraceSources } from "./trace-source";
export type ExecutionState = "queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "stopped" | "succeeded" | "failed";
export type ExecutionCapability = "output" | "prompt-delivery" | "recovery" | "stop";
export type PromptDeliveryState = "pending" | "submitting" | "accepted" | "ambiguous" | "failed";

export interface BackendCommandResult {
  ok: boolean;
  status: number;
  exitCode: number | null;
  body: string;
  requestBody: string;
}

export interface LaunchRequest {
  runId: string;
  /** Backend-owned provisional handle, persisted before provisioning when supported. */
  reservation?: RunHandle;
  prompt: string;
  /** Control-plane only: provisioned into an exe.dev proxy, never the guest. */
  runProxy?: { targetOrigin: string; credential: string };
  traceSources?: TraceSources;
  harness?: { executable: string; args: string[]; env: Record<string, string> };
  code?: { script: string; context: Record<string, unknown> };
}

/** Opaque to orchestration. Only the backend that created it may interpret id. */
export interface RunHandle { backendKind: string; id: string; runProxyName?: string; /** Stable provider operation key retained across a scheduler restart. */ operationId?: string; }

export interface ExecutionObservation {
  systemd?: import("./harness-diagnostics").ExecutionDiagnostics["systemd"];
  state: ExecutionState;
  detail?: string;
  command?: BackendCommandResult;
  /** Backend evidence only; guest supplied result documents cannot set this. */
  failure?: { source: "run" | "system"; code: string; reason: string };
}

export interface LaunchReceipt {
  handle: RunHandle;
  destinationUrl: string;
  capabilities: readonly ExecutionCapability[];
  observation: ExecutionObservation;
  command?: BackendCommandResult;
}

export interface PromptDeliveryReceipt {
  state: Exclude<PromptDeliveryState, "pending" | "submitting">;
  command?: BackendCommandResult;
}
export interface ArtifactCollectionRequest { uploadUrl: string; contentType: string; source?: TraceSource; discoverCommand?: string; }
export interface JobFileCollectionRequest { path: string; uploadUrl: string; }
export interface TraceChunkCollectionRequest { uploadUrl: string; source?: TraceSource; discoverCommand?: string; generation: string | null; offset: number; previousHash: string; }
export interface ArtifactCollectionReceipt { ok: boolean; detail?: string; command?: BackendCommandResult; }

/** Optional execution backend capabilities used while collecting a finished run. */
export interface JobResultReader { readJobResult(handle: RunHandle): Promise<string | null>; }
export interface JobFileCollector {
  listJobFiles(handle: RunHandle): Promise<string[]>;
  collectJobFile(handle: RunHandle, request: JobFileCollectionRequest): Promise<ArtifactCollectionReceipt>;
}
export interface HarnessLogReader { readHarnessLog(handle: RunHandle): Promise<string>; }
export interface ArtifactCollector {
  collectArtifact(handle: RunHandle, request: ArtifactCollectionRequest): Promise<ArtifactCollectionReceipt>;
  collectTraceChunk?(handle: RunHandle, request: TraceChunkCollectionRequest): Promise<ArtifactCollectionReceipt>;
}
export interface TraceChunkCollector { collectTraceChunk(handle: RunHandle, request: TraceChunkCollectionRequest): Promise<ArtifactCollectionReceipt>; }
export interface ExecutionTerminator { terminate(handle: RunHandle): Promise<ExecutionObservation>; }

/** Provider-neutral boundary. Output and recovery are opt-in capabilities. */
export interface ExecutionBackend {
  readonly kind: string;
  readonly capabilities: readonly ExecutionCapability[];
  /** Reserve a cleanup handle before provisioning, or return null when the provider allocates one during launch. */
  reserve?(runId: string): RunHandle | null;
  launch(request: LaunchRequest): Promise<LaunchReceipt>;
  inspect(handle: RunHandle): Promise<ExecutionObservation>;
  stop(handle: RunHandle): Promise<ExecutionObservation>;
  deliverPrompt?(handle: RunHandle, prompt: string): Promise<PromptDeliveryReceipt>;
  readOutput?(handle: RunHandle): Promise<string | null>;
  collectArtifact?(handle: RunHandle, request: ArtifactCollectionRequest): Promise<ArtifactCollectionReceipt>;
  collectTraceChunk?(handle: RunHandle, request: TraceChunkCollectionRequest): Promise<ArtifactCollectionReceipt>;
}

/** Maps persisted execution states onto the public contract. */
export function normalizeExecutionState(state: unknown): ExecutionState {
  switch (String(state)) {
    case "queued": case "reserved": case "starting": case "running": case "blocked": case "stopping": case "stopped": case "succeeded": case "failed": return String(state) as ExecutionState;
    case "done": return "succeeded";
    case "cancelled": return "stopped";
    default: return "failed";
  }
}
