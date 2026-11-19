import type { DatabaseClient } from "./database";
import { reserveExecutionSlot } from "./queue-admission";
import { InvocationError } from "../job-domain";

export interface SubmittedRun {
  id: string;
  invocationId: string;
  jobId: string | null;
  projectId: string;
  name: string;
  source: string;
  claim: string;
  encryptedPrompt: string;
  encryptedSkills?: string;
  skill?: { id: string; key: string; revision: number };
  config: Record<string, unknown>;
  workspaceName: string;
  createdAt: string;
  jobLimit?: number;
}

/** The invocation claim, capacity decision, paired execution rows, authorization
 * and scheduler wake all commit in the caller's admission transaction. */
export async function submitRun(client: DatabaseClient, tenant: string, run: SubmittedRun) {
  const project = (
    await client.query("SELECT run_defaults FROM app.projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [
      tenant,
      run.projectId,
    ])
  ).rows[0];
  if (!project) throw new Error("Run project is unavailable");
  const capacity = project.run_defaults?.capacity;
  let available = Number.POSITIVE_INFINITY;
  if (capacity) {
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE jr.state IN ('reserved','starting','running','blocked','stopping'))::int active,
      count(*) FILTER (WHERE jr.state='queued')::int waiting FROM app.runs r JOIN app.job_runs jr USING (tenant_id,id)
      WHERE r.tenant_id=$1 AND r.project_id=$2`,
      [tenant, run.projectId],
    );
    available = Math.max(0, capacity - rows[0].active);
    if (!available && rows[0].waiting >= capacity)
      throw new InvocationError("queue_full", "The project's run queue is full.");
  }
  const reservation = { state: available ? "reserved" : "queued" };
  if (run.jobId)
    await reserveExecutionSlot(client, tenant, run.jobId, reservation, run.jobLimit ?? 1, available);
  await client.query(
    `INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,encrypted_skill_snapshot,run_name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [
      tenant,
      run.id,
      run.jobId,
      run.invocationId,
      reservation.state,
      run.encryptedPrompt,
      run.encryptedSkills ?? null,
      run.name,
      run.createdAt,
    ],
  );
  const provider = run.config.executionProvider;
  const backend =
    provider === "fly" || provider === "docker"
      ? provider
      : run.config.agentKind === "Amp"
        ? "amp"
        : "exe-vm";
  await client.query(
    `INSERT INTO app.runs(tenant_id,id,project_id,job_id,invocation_id,provider,issue_id,run_name,agent_name,workspace_name,agent_kind,state,
    execution_backend_kind,execution_config,execution_capabilities,result_protocol_version,launch_skill_id,launch_skill_key,launch_skill_revision,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,$11,$12,$13,$14,1,$15,$16,$17,$18,$18)`,
    [
      tenant,
      run.id,
      run.projectId,
      run.jobId,
      run.invocationId,
      run.source,
      run.claim,
      run.name,
      run.workspaceName,
      run.config.agentKind,
      reservation.state,
      backend,
      run.config,
      JSON.stringify(backend === "amp" ? ["stop"] : ["recovery", "stop"]),
      run.skill?.id,
      run.skill?.key,
      run.skill?.revision,
      run.createdAt,
    ],
  );
  await client.query(
    "INSERT INTO app.wake_hints(key,not_before) VALUES ('global',now()) ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before)",
  );
  return reservation.state as "queued" | "reserved";
}
