import { vmGrantInput, vmGrantList, vmGrantResult, vmRevokeResult } from "../api/vm-grant-contracts";
import { VmGrantRepository, vmGrantActor, type VmGrant } from "../storage/vm-grant-repository";
import { provisionVmGrant } from "./vm-enrollment";
import { vmGrantAudience } from "./vm-grant-provider";
import { writeVmPermissionSnapshot } from "./vm-permissions";

import type { Env, OAuthProps } from "../../types";
import { databaseFor } from "../../postgres/database";

import { AGENT_SCOPES } from "../../access-tokens";

import { ServiceError, publicValue } from "../../service-contract";

export class VmGrantsService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}

  private vmGrantView(row: VmGrant) {
    return {
      id: row.id, providerId: row.provider_id, provider: row.provider_kind === "fly" ? "fly.io" : "exe.dev",
      vm: row.vm, app: row.vm_app || null, scopes: row.scopes,
      revision: row.revision,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    };
  }

  async listVmGrants() {
    await this.authorize("vms:read");
    const repository = new VmGrantRepository(databaseFor(this.env).pool, this.auth.tenantId);
    return publicValue(vmGrantList, (await repository.list()).map(row => this.vmGrantView(row)));
  }

  async grantVmPermissions(value: unknown) {
    await this.authorize("vms:edit");
    const { target, permissions } = vmGrantInput.parse(value);
    const database = databaseFor(this.env);
    const row = target.kind === "machine"
      ? await provisionVmGrant(this.env, this.auth, { ...target, permissions })
      : await writeVmPermissionSnapshot(database, this.auth, permissions, async (db, snapshot) => {
        const repository = new VmGrantRepository(db, this.auth.tenantId);
        const updated = await repository.replace(target.grantId, target.expectedRevision, snapshot.scopes, snapshot.presetId, vmGrantActor(this.auth));
        if (updated) return updated;
        const current = await repository.get(target.grantId);
        if (!current?.activated_at || current.revoked_at) throw new ServiceError(404, "not_found", "Active VM grant not found.");
        throw new ServiceError(409, "stale_revision", "The VM grant changed. Refresh it and retry.");
      });
    return publicValue(vmGrantResult, {
      ...this.vmGrantView(row),
      authentication: { audience: vmGrantAudience(row.id), guestKeyPath: `.factorize-vm-grants/${row.id}.pem` },
    });
  }

  async revokeVmPermissions(id: string) {
    await this.authorize("vms:edit");
    const repository = new VmGrantRepository(databaseFor(this.env).pool, this.auth.tenantId);
    if (!await repository.revoke(id, vmGrantActor(this.auth))) {
      const row = await repository.get(id);
      if (!row?.revoked_at) throw new ServiceError(404, "not_found", "VM grant not found.");
    }
    return publicValue(vmRevokeResult, { id, revoked: true });
  }
}
