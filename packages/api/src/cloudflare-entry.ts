import { WorkflowEntrypoint } from "cloudflare:workers";
import type { Env } from "./types";

export { default, AlarmCoordinator } from "./worker";

// Preserve the deployed workflow binding while the retirement runs through release.
export class SkillPushWorkflow extends WorkflowEntrypoint<Env> {
  async run() {}
}
