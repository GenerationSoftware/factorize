// The first static release is dispatched from the reviewed migration branch.
// Keep its chunks available after main takes over production deployments.
const releaseBranches = new Set(["main", "gen-2157-auth-contracts", "feat/gen-2158-webhook-conditions"]);
export function isTrustedAppRelease(artifact, run, jobs, repository, now = Date.now()) {
  return artifact.name === "factorize-app-assets" && !artifact.expired &&
    Date.parse(artifact.created_at) >= now - 30 * 86400000 &&
    releaseBranches.has(artifact.workflow_run?.head_branch) &&
    run.head_branch === artifact.workflow_run.head_branch &&
    run.path === ".github/workflows/deploy.yml" &&
    run.head_repository?.full_name === repository &&
    jobs.some(job => job.steps?.some(step =>
      step.name === "Deploy app Worker" && step.conclusion === "success"));
}
