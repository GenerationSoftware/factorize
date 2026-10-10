import { InvocationError } from "../job-domain";
import type { DatabaseClient } from "./database";

/** Hold until commit. All admission writers serialize on the tenant-qualified job. */
export async function lockJobQueue(client: DatabaseClient, tenantId: string, jobId: string): Promise<void> {
  await client.query("SELECT id FROM app.jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, jobId]);
}

/** Check after claiming the occurrence so duplicate retries still return their original run. */
export async function reserveExecutionSlot(client: DatabaseClient, tenantId: string, jobId: string, run: { state: string }): Promise<void> {
  const job = await client.query<{ concurrency_limit: number }>("SELECT concurrency_limit FROM app.jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, jobId]);
  if (!job.rows[0]) throw new Error("Job disappeared during invocation admission");
  const activeStates = "('reserved','starting','running','blocked','stopping')";

  // A newly free slot belongs to the oldest waiter before it belongs to a new arrival.
  while (true) {
    const active = await client.query<{ count: string }>(`SELECT count(*)::text count FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state IN ${activeStates}`, [tenantId, jobId]);
    if (Number(active.rows[0]?.count ?? 0) >= job.rows[0].concurrency_limit) break;
    const promoted = await client.query(`UPDATE app.job_runs SET state='reserved',updated_at=now() WHERE tenant_id=$1 AND id=(SELECT id FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`, [tenantId, jobId]);
    if (!promoted.rowCount) break;
  }

  const active = await client.query<{ count: string }>(`SELECT count(*)::text count FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state IN ${activeStates}`, [tenantId, jobId]);
  if (Number(active.rows[0]?.count ?? 0) < job.rows[0].concurrency_limit) {
    run.state = "reserved";
    return;
  }
  const queued = await client.query("SELECT id FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state='queued' LIMIT 1", [tenantId, jobId]);
  if (queued.rows.length) throw new InvocationError("queue_full", "This job has no free execution slot and already has one waiting run. Try again after capacity is released.");
  run.state = "queued";
}
