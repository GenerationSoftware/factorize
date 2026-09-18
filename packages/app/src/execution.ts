export type ExecutionState = "queued" | "starting" | "running" | "blocked" | "stopping" | "stopped" | "succeeded" | "failed";
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
  prompt: string;
  harness?: { executable: string; args: string[]; env: Record<string, string> };
}

/** Opaque to orchestration. Only the backend that created it may interpret id. */
export interface RunHandle { backendKind: string; id: string; }

export interface ExecutionObservation {
  state: ExecutionState;
  detail?: string;
  command?: BackendCommandResult;
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
export interface ArtifactCollectionReceipt { ok: boolean; detail?: string; command?: BackendCommandResult; }

/** Provider-neutral boundary. Output and recovery are opt-in capabilities. */
export interface ExecutionBackend {
  readonly kind: string;
  readonly capabilities: readonly ExecutionCapability[];
  launch(request: LaunchRequest): Promise<LaunchReceipt>;
  inspect(handle: RunHandle): Promise<ExecutionObservation>;
  stop(handle: RunHandle): Promise<ExecutionObservation>;
  deliverPrompt?(handle: RunHandle, prompt: string): Promise<PromptDeliveryReceipt>;
  readOutput?(handle: RunHandle): Promise<string | null>;
  collectArtifact?(handle: RunHandle, request: { uploadUrl: string; discoverCommand: string; contentType: string }): Promise<ArtifactCollectionReceipt>;
}

/** Maps persisted execution states onto the public contract. */
export function normalizeExecutionState(state: unknown): ExecutionState {
  switch (String(state)) {
    case "queued": case "starting": case "running": case "blocked": case "stopping": case "stopped": case "succeeded": case "failed": return String(state) as ExecutionState;
    case "done": return "succeeded";
    case "cancelled": return "stopped";
    default: return "failed";
  }
}
