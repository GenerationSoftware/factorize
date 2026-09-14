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
  agentName: string;
  workspaceName: string;
  runPath: string;
  lease: string;
}

export interface RunHandle {
  backend: string;
  agentName: string;
}

export interface LaunchReceipt {
  handle: RunHandle;
  command: BackendCommandResult;
}

export interface PromptDeliveryReceipt {
  state: Exclude<PromptDeliveryState, "pending" | "submitting">;
  command: BackendCommandResult;
}

/** Boundary implemented by exe.dev + Herdr today and by alternative runners later. */
export interface ExecutionBackend {
  readonly kind: string;
  launch(request: LaunchRequest): Promise<LaunchReceipt>;
  deliverPrompt(handle: RunHandle, prompt: string): Promise<PromptDeliveryReceipt>;
  inspect(handle: RunHandle): Promise<BackendCommandResult>;
  readOutput(handle: RunHandle): Promise<BackendCommandResult>;
  stop(handle: RunHandle): Promise<BackendCommandResult>;
}
