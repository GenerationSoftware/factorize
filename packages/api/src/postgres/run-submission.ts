import type { DatabaseClient } from "./database";
import { reserveExecutionSlot } from "./queue-admission";
import { InvocationError } from "../job-domain";

export interface SubmittedRun {
  id: string;
  invocationId: string;
  triggerId: string | null;
  name: string;
  source: string;
  claim: string;
  encryptedPrompt: string;
  encryptedPromptPreview?:string;
  encryptedContextPrompt?:string;
  encryptedSkills?: string;
  skill?: { id: string; key: string; revision: number };
  config: Record<string, unknown>;
  workspaceName: string;
  createdAt: string;
  triggerLimit?: number;
}

/** The invocation claim, capacity decision, paired execution rows, authorization
 * and scheduler wake all commit in the caller's admission transaction. */
export async function submitRun(client: DatabaseClient, tenant: string, run: SubmittedRun) {
  const team = (
    await client.query("SELECT run_defaults FROM app.team_settings WHERE tenant_id=$1 FOR UPDATE", [tenant])
  ).rows[0];
  if (!team) throw new Error("Run team is unavailable");
  const capacity = team.run_defaults?.capacity;
  let available = Number.POSITIVE_INFINITY, waiting = 0;
  if (capacity) {
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE jr.state IN ('reserved','starting','running','blocked','stopping'))::int active,
      count(*) FILTER (WHERE jr.state='queued')::int waiting FROM app.runs r JOIN app.trigger_runs jr USING (tenant_id,id)
      WHERE r.tenant_id=$1`,
      [tenant],
    );
    available = Math.max(0, capacity - rows[0].active);
    waiting=rows[0].waiting;
  }
  const skillLimit=Number(run.config.skillConcurrencyLimit??0);
  if(run.skill && skillLimit>0){
    const active=(await client.query("SELECT count(*)::int n FROM app.runs WHERE tenant_id=$1 AND launch_skill_id=$2 AND state IN ('reserved','starting','running','blocked','stopping')",[tenant,run.skill.id])).rows[0].n;
    if(active>=skillLimit)available=0;
  }
  if(!available && capacity && waiting>=capacity)throw new InvocationError("queue_full","The team's run queue is full.");
  const reservation = { state: available ? "reserved" : "queued" };
  if (run.triggerId)
    await reserveExecutionSlot(client, tenant, run.triggerId, reservation, run.triggerLimit ?? 1, available);
  await client.query(
    `INSERT INTO app.trigger_runs(tenant_id,id,trigger_id,invocation_id,state,encrypted_prompt,encrypted_skill_snapshot,run_name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [
      tenant,
      run.id,
      run.triggerId,
      run.invocationId,
      reservation.state,
      run.encryptedPrompt,
      run.encryptedSkills ?? null,
      run.name,
      run.createdAt,
    ],
  );
  const provider = run.config.executionProvider;
  const backend = run.config.executionType!=="code" ? "hosted-pi" :
    provider === "fly" || provider === "docker"
      ? provider
      : run.config.agentKind === "Amp"
        ? "amp"
        : "exe-vm";
  await client.query(
    `INSERT INTO app.runs(tenant_id,id,trigger_id,invocation_id,provider,issue_id,run_name,agent_name,workspace_name,agent_kind,state,
    execution_backend_kind,execution_config,execution_capabilities,result_protocol_version,launch_skill_id,launch_skill_key,launch_skill_revision,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17,$17)`,
    [
      tenant,
      run.id,
      run.triggerId,
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
  await client.query("UPDATE app.runs SET encrypted_prompt_preview=$3,encrypted_context_prompt=$4 WHERE tenant_id=$1 AND id=$2",[tenant,run.id,run.encryptedPromptPreview??null,run.encryptedContextPrompt??null]);
  await client.query(
    "INSERT INTO app.wake_hints(key,not_before) VALUES ('global',now()) ON CONFLICT (key) DO UPDATE SET not_before=least(app.wake_hints.not_before,excluded.not_before)",
  );
  return reservation.state as "queued" | "reserved";
}
