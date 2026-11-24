import { basename } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Relative costs from the isolated PostgreSQL run. PostgreSQL and unit files
// added later get a default weight and remain in the shard inventory.
const costs: Record<string, number> = {
  "proxy-operations.postgres.test.ts": 32,
  "proxy-results.postgres.test.ts": 28,
  "proxy-payloads.postgres.test.ts": 21,
  "oauth-onboarding.postgres.test.ts": 9,
  "x-oauth-flow.postgres.test.ts": 6,
  "event-match-repository.postgres.test.ts": 5,
  "oidc.postgres.test.ts": 4,
  "mcp-skills.postgres.test.ts": 4,
};

export class BalancedValidationSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]) {
    const { count, index } = this.ctx.config.shard!;
    const ranked = files.map(file => {
      const name = basename(file.moduleId);
      return { file, weight: costs[name] ?? (name.endsWith(".postgres.test.ts") ? 2 : 1) };
    }).sort((first, second) =>
      second.weight - first.weight || first.file.moduleId.localeCompare(second.file.moduleId));

    const shards = Array.from({ length: count }, () => ({ weight: 0, files: [] as TestSpecification[] }));
    for (const entry of ranked) {
      const shard = shards.reduce((lightest, candidate) => candidate.weight < lightest.weight ? candidate : lightest);
      shard.files.push(entry.file);
      shard.weight += entry.weight;
    }

    return shards[index - 1].files;
  }
}
