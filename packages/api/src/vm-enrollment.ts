import { AgentApiError } from "./agent-api-error";
import { databaseFor, type DatabaseClient } from "./postgres/database";
import { VmGrantRepository, vmGrantActor, type VmGrant, type VmProvider } from "./postgres/vm-grant-repository";
import type { Env, OAuthProps } from "./types";
import { flyVmGrantProvider, requireVmGrantProvider } from "./vm-grant-provider";
import { writeVmPermissionSnapshot, type VmPermissionSource } from "./vm-permissions";

export type VmEnrollmentInput = {
  providerId: string;
  vm: string;
  app?: string;
  requestKey: string;
  permissions: VmPermissionSource;
};

const conflict = () => new AgentApiError(409, "conflict", "The VM already has a grant, or this enrollment request has changed.");

async function providerConnection(db: DatabaseClient, tenantId: string, id: string) {
  const row = (await db.query<{ kind: VmProvider; epoch: number }>(
    `SELECT kind,epoch FROM app.agent_integrations
     WHERE tenant_id=$1 AND id=$2 AND kind IN ('exe','fly') AND available FOR SHARE`,
    [tenantId, id],
  )).rows[0];
  if (!row) throw new AgentApiError(404, "not_found", "VM provider connection not found.");
  return row;
}

function sameScopes(a: string[], b: string[]) {
  return a.length === b.length && a.every(scope => b.includes(scope));
}

export async function provisionVmGrant(env: Env, auth: OAuthProps, input: VmEnrollmentInput): Promise<VmGrant> {
  const database = databaseFor(env);
  const actor = vmGrantActor(auth);
  const reserved = await writeVmPermissionSnapshot(database, auth, input.permissions, async (db, snapshot) => {
    const provider = await providerConnection(db, auth.tenantId, input.providerId);
    if ((provider.kind === "fly") !== Boolean(input.app)) {
      throw new AgentApiError(400, "invalid_request", "Fly grants require an app and Machine ID. exe.dev grants require a VM name.");
    }
    requireVmGrantProvider(provider.kind);
    const repo = new VmGrantRepository(db, auth.tenantId);
    const { grant } = await repo.reserve({
      provider_id: input.providerId, provider_kind: provider.kind, provider_epoch: provider.epoch,
      vm: input.vm, vm_app: input.app ?? "",
    }, input.requestKey, snapshot.scopes, snapshot.presetId, actor);
    if (!grant || grant.revoked_at || grant.provider_id !== input.providerId || grant.provider_kind !== provider.kind
        || grant.provider_epoch !== provider.epoch || grant.vm !== input.vm || grant.vm_app !== (input.app ?? "")
        || grant.created_by !== actor || grant.preset_id !== snapshot.presetId || !sameScopes(grant.scopes, snapshot.scopes)) {
      throw conflict();
    }
    return grant;
  });
  if (reserved.activated_at) return reserved;

  const binding = await (await flyVmGrantProvider(env, reserved)).enroll();
  try {
    return await writeVmPermissionSnapshot(database, auth, input.permissions, async (db, snapshot) => {
      const provider = await providerConnection(db, auth.tenantId, input.providerId);
      if (provider.epoch !== reserved.provider_epoch || provider.kind !== reserved.provider_kind
          || snapshot.presetId !== reserved.preset_id || !sameScopes(snapshot.scopes, reserved.scopes)) throw conflict();

      const repository = new VmGrantRepository(db, auth.tenantId);
      const grant = await repository.get(reserved.id, true);
      if (!grant || grant.revoked_at) throw conflict();
      if (grant.activated_at) return grant;
      const activated = await repository.activate(grant.id, binding);
      if (!activated) throw conflict();
      return activated;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw conflict();
    throw error;
  }
}
