import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { databaseFor } from "./postgres/database";
import { SkillLibrary } from "./skill-library";
import type { Env } from "./types";

export { default, AlarmCoordinator } from "./worker";

type Push = {
  type: "cf.artifacts.repo.pushed";
  source: { namespace: string; repoName: string };
  payload: { ref: string };
};

export class SkillPushWorkflow extends WorkflowEntrypoint<Env, Push> {
  async run(event: WorkflowEvent<Push>, step: WorkflowStep) {
    const { source, payload } = event.payload;
    if (source.namespace !== "factorize-skills" || payload.ref !== "refs/heads/main") return;
    await step.do("Publish skill directories", async () => {
      const row = (
        await databaseFor(this.env).pool.query(
          "SELECT tenant_id FROM app.skill_libraries WHERE repo=$1 AND source->>'kind'='managed'",
          [source.repoName],
        )
      ).rows[0];
      if (row) await new SkillLibrary(this.env, row.tenant_id).sync({ repo: source.repoName });
    });
  }
}
