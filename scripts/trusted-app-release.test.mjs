import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedAppRelease } from "./trusted-app-release.mjs";
test("retention includes the initial dispatched cutover and rejects untrusted archives", () => {
  const repository = "GenerationSoftware/factorize", now = Date.now();
  const artifact = { name: "factorize-app-assets", expired: false, created_at: new Date(now).toISOString(), workflow_run: { head_branch: "gen-2157-auth-contracts" } };
  const run = { head_branch: "gen-2157-auth-contracts", path: ".github/workflows/deploy.yml", head_repository: { full_name: repository } };
  const jobs = [{ steps: [{ name: "Deploy app Worker", conclusion: "success" }] }];
  assert.equal(isTrustedAppRelease(artifact, run, jobs, repository, now), true);
  assert.equal(isTrustedAppRelease({ ...artifact, workflow_run: { head_branch: "main" } }, { ...run, head_branch: "main" }, jobs, repository, now), true);
  for (const changed of [{ expired: true }, { name: "other" }, { created_at: new Date(now - 31 * 86400000).toISOString() }, { workflow_run: { head_branch: "unreviewed" } }]) assert.equal(isTrustedAppRelease({ ...artifact, ...changed }, run, jobs, repository, now), false);
  for (const changed of [{ head_branch: "main" }, { path: ".github/workflows/other.yml" }, { head_repository: { full_name: "fork/factorize" } }]) assert.equal(isTrustedAppRelease(artifact, { ...run, ...changed }, jobs, repository, now), false);
  assert.equal(isTrustedAppRelease(artifact, run, [{ steps: [{ name: "Deploy app Worker", conclusion: "failure" }] }], repository, now), false);
});
