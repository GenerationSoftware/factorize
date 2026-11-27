import type { HetznerConnectionRepository } from "../../credentials/storage/hetzner-connection-repository";
import { ServiceError } from "../../service-contract";
import { hetznerConnectionInput } from "../api/hetzner-contracts";
import { createHetznerCloudClient, HetznerCloudError } from "../providers/hetzner-cloud";
import { reportIntegrationFailure } from "./diagnostics";

export class HetznerInventoryService {
  constructor(private connections: HetznerConnectionRepository) {}

  async connection() {
    const project = await this.connections.get();
    return { connection: project ? { name: project.name } : null };
  }

  async connectionRevision() { return (await this.connections.get())?.revision ?? null; }

  async save(input: unknown) {
    const { name, token } = hetznerConnectionInput.parse(input);
    await this.withProviderError("validate_token", () => createHetznerCloudClient().validate(token));
    await this.connections.save(name, token);
    return { connection: { name } };
  }

  async delete() { return { deleted: await this.connections.delete() }; }

  async inventory() {
    const project = await this.requireProject();
    return this.withProviderError("list_servers", () => createHetznerCloudClient().inventory(project.token));
  }

  async targetForServer(id: number) {
    const project = await this.requireProject();
    const target = await this.withProviderError("lookup_server", () => createHetznerCloudClient().target(project.token, id));
    return { ...target, connectionRevision: project.revision };
  }

  private async requireProject() {
    const project = await this.connections.get();
    if (!project) throw new ServiceError(404, "hetzner_not_connected", "Connect a Hetzner project first.");
    return project;
  }

  private async withProviderError<T>(operation: "validate_token" | "list_servers" | "lookup_server", request: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try { return await request(); }
    catch (error) {
      if (!(error instanceof HetznerCloudError)) throw error;
      const status = error.kind === "auth" ? 422 : error.kind === "not_found" ? 404 : 502;
      const requestId = reportIntegrationFailure({ provider: "hetzner", operation, reason: error.reason,
        upstreamStatus: error.upstreamStatus }, started, status >= 500);
      throw new ServiceError(status, "hetzner_inventory_error", error.message, requestId);
    }
  }
}
