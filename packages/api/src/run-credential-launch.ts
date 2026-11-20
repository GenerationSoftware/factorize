import type { Database } from "./postgres/database";
import type { Env } from "./types";
import { CredentialRepository } from "./postgres/credential-repository";
import { GitHubRepository } from "./postgres/github-repository";
import { isPublicHttpsOrigin } from "./public-address";
import {configuredPiProvider} from "./pi-provider";

export class RunCredentialRepairRequired extends Error {
  constructor(message="A selected credential is unavailable or requires reconnection. Repair the trigger's selections and start a new run; this run's selection snapshot is unchanged.") { super(message); }
}
/** Fail closed before provisioning, preserving all unavailable selections for
 * explicit repair. No unlock/proxy service is a launch prerequisite. */
export async function requireRunCredentials(input: {database: Database; env: Env; tenantId: string; runId: string; config: Record<string, any>}): Promise<void> {
  const {database, env, tenantId, runId, config} = input;
  const repository = new CredentialRepository(database, tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
  const revoked = (await database.pool.query("SELECT 1 FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2 LIMIT 1", [tenantId, runId])).rowCount;
  if (revoked) throw new RunCredentialRepairRequired();
  const ids = config.portableIntegrationIds ?? [], githubIds = config.githubInstallationIds ?? [];
  if (!Array.isArray(ids) || !Array.isArray(githubIds) || new Set(ids).size !== ids.length || new Set(githubIds).size !== githubIds.length
      || ![undefined, "native", "portable"].includes(config.modelAccess)
      || (config.modelAccess !== "portable" && config.modelAccountId !== undefined)
      || (config.executionType === "code" && (config.modelAccess === "portable" || config.modelAccountId !== undefined))) throw new RunCredentialRepairRequired();
  for (const id of ids) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new RunCredentialRepairRequired();
    const credential = await repository.managedCredential(id, "bearer");
    if (!credential?.origin || !isPublicHttpsOrigin(credential.origin, env.APP_ORIGIN)) throw new RunCredentialRepairRequired();
  }
  for (const id of githubIds) if (!Number.isSafeInteger(id) || id < 1 || (await new GitHubRepository(database, tenantId).installation(id))?.state !== "active") throw new RunCredentialRepairRequired();
  if (config.linearConnectionId !== undefined && (config.linearConnectionId !== "linear" || !(await database.pool.query("SELECT 1 FROM app.connections WHERE tenant_id=$1 AND kind='linear'", [tenantId])).rowCount)) throw new RunCredentialRepairRequired();
  if (config.modelAccess === "portable") {
    if (typeof config.modelAccountId !== "string") throw new RunCredentialRepairRequired();
    try { if (!configuredPiProvider((await repository.managedCredential(config.modelAccountId,"model"))?.payload ?? "")) throw new RunCredentialRepairRequired(); }
    catch { throw new RunCredentialRepairRequired(); }
  }
}
