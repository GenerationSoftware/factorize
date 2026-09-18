import { InvocationError } from "../job-domain";
import type { DatabaseClient } from "./database";

/** Hold until commit. All admission writers serialize on the tenant-qualified job. */
export async function lockJobQueue(client: DatabaseClient, tenantId: string, jobId: string): Promise<void> {
  await client.query("SELECT id FROM app.jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, jobId]);
}

/** Check after claiming the occurrence so duplicate retries still return their original run. */
export async function requireQueueCapacity(client: DatabaseClient, tenantId: string, jobId: string): Promise<void> {
  const queued = await client.query("SELECT id FROM app.job_runs WHERE tenant_id=$1 AND job_id=$2 AND state='queued' LIMIT 1", [tenantId, jobId]);
  if (queued.rows.length) throw new InvocationError("queue_full", "This job already has a queued run. Try again after it starts.");
}
