import type { ExecutionBackend, ExecutionObservation, LaunchReceipt, LaunchRequest, PromptDeliveryReceipt, RunHandle } from "./execution";
import { agentOutputCommand, agentStatusCommand, exec, herdrAgentStatus, launchAgentCommand, promptAgentCommand, stopAgentCommand, type ExeConnection } from "./exe";

/** Execution adapter for the current exe.dev transport, Herdr supervisor, and configured harness. */
export class ExeHerdrBackend implements ExecutionBackend {
  readonly kind = "exe-herdr";
  readonly capabilities = ["output", "prompt-delivery", "recovery"] as const;

  constructor(private readonly connection: ExeConnection, private readonly launchContext?: { agentName: string; workspaceName: string; runPath: string; lease: string }) {}

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    if (!this.launchContext) throw new Error("ExeHerdrBackend launch context is required");
    const { agentName, workspaceName, runPath, lease } = this.launchContext;
    const command = await exec(this.connection, launchAgentCommand(agentName, this.connection, workspaceName, runPath, lease, request.prompt));
    return { handle: { backendKind: this.kind, id: agentName }, destinationUrl: "https://exe.dev/", capabilities: this.capabilities, observation: { state: command.ok ? "starting" : "failed", command }, command };
  }

  async deliverPrompt(handle: RunHandle, prompt: string): Promise<PromptDeliveryReceipt> {
    const command = await exec(this.connection, promptAgentCommand(this.connection, this.agentName(handle), prompt));
    const state = command.ok && (command.exitCode === null || command.exitCode === 0)
      ? "accepted"
      : command.status >= 500 || command.exitCode === null ? "ambiguous" : "failed";
    return { state, command };
  }

  async inspect(handle: RunHandle): Promise<ExecutionObservation> {
    const command = await exec(this.connection, agentStatusCommand(this.connection, this.agentName(handle)));
    if (!command.ok) return { state: "failed", detail: "Execution could not be inspected", command };
    const state = herdrAgentStatus(command.body);
    return { state: state === "blocked" ? "blocked" : state === "done" || state === "idle" ? "succeeded" : "running", command };
  }
  async readOutput(handle: RunHandle) { const command = await exec(this.connection, agentOutputCommand(this.connection, this.agentName(handle))); return command.ok ? command.body : null; }
  async stop(handle: RunHandle): Promise<ExecutionObservation> { const command = await exec(this.connection, stopAgentCommand(this.connection, this.agentName(handle))); return { state: command.ok ? "stopped" : "failed", command }; }
  private agentName(handle: RunHandle): string { if (handle.backendKind !== this.kind || !handle.id) throw new Error(`Invalid ${this.kind} execution handle`); return handle.id; }
}
