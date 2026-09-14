import type { ExecutionBackend, LaunchRequest, PromptDeliveryReceipt, RunHandle } from "./execution";
import { agentOutputCommand, agentStatusCommand, exec, launchAgentCommand, promptAgentCommand, stopAgentCommand, type ExeConnection } from "./exe";

/** Execution adapter for the current exe.dev transport, Herdr supervisor, and configured harness. */
export class ExeHerdrBackend implements ExecutionBackend {
  readonly kind = "exe-herdr";

  constructor(private readonly connection: ExeConnection) {}

  async launch(request: LaunchRequest) {
    const command = await exec(this.connection, launchAgentCommand(request.agentName, this.connection, request.workspaceName, request.runPath, request.lease));
    return { handle: { backend: this.kind, agentName: request.agentName }, command };
  }

  async deliverPrompt(handle: RunHandle, prompt: string): Promise<PromptDeliveryReceipt> {
    const command = await exec(this.connection, promptAgentCommand(this.connection, handle.agentName, prompt));
    const state = command.ok && (command.exitCode === null || command.exitCode === 0)
      ? "accepted"
      : command.status >= 500 || command.exitCode === null ? "ambiguous" : "failed";
    return { state, command };
  }

  inspect(handle: RunHandle) { return exec(this.connection, agentStatusCommand(this.connection, handle.agentName)); }
  readOutput(handle: RunHandle) { return exec(this.connection, agentOutputCommand(this.connection, handle.agentName)); }
  stop(handle: RunHandle) { return exec(this.connection, stopAgentCommand(this.connection, handle.agentName)); }
}
