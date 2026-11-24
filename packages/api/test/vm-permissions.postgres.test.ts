import { describe, expect, it, vi } from "vitest";
import { VmGrantRepository } from "../src/postgres/vm-grant-repository";
import { currentVmScopes, resolveVmPermissions, writeVmPermissionSnapshot } from "../src/vm-permissions";
import { loadingFixture } from "./helpers/loading-fixture";
import { AgentApiService } from "../src/agent-api";
import { requestApiInput } from "../src/agent-api-contracts";
import { processProxyOperation, ProxyOperations } from "../src/proxy-operations";
import type { Env } from "../src/types";

const url = process.env.AUTH_TEST_DATABASE_URL;

describe.skipIf(!url)("VM grant persistence and delegation", () => {
  it("isolates retained responses and denies queued dispatch after revocation", async () => {
    const f = await loadingFixture(url!);
    try {
      const provider = crypto.randomUUID(), integration = crypto.randomUUID();
      await f.db.pool.query(`INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy)
        VALUES($1,$2,'fly','fly','Fly',true,'requestable'),($1,$3,'bearer',$3::uuid::text,'Upstream',true,'baseline')`,
      [f.tenantId, provider, integration]);
      const repo = new VmGrantRepository(f.db.pool, f.tenantId);
      const scopes = ["proxy:use", `integration:${integration}:1`];
      const { grant } = await repo.reserve({ provider_id: provider, provider_kind: "fly", provider_epoch: 1, vm: "machine", vm_app: "app" }, "queue", scopes, null, "actor");
      const id = grant!.id;
      await repo.activate(id, { machine_key: "machine", issuer: "issuer", subject: "subject", public_key: { kty: "EC" } });
      const auth = { ...f.auth, userId: id, authMethod: "vm" as const, vmGrantId: id, vmTokenExpiresAt: Date.now() / 1000 + 300, scopes };
      const env = { ...f.env, FLY_VM_GRANTS_ENABLED: "true", PROXY_ARTIFACTS: {}, SCHEDULER: {
        idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ ok: true }) }),
      } } as unknown as Env;
      const operations = new ProxyOperations(env, auth);
      const operation = await operations.start(requestApiInput.parse({ integration, method: "GET", path: "/" }));
      expect(operation.state).toBe("queued");
      const missingIntegration = { ...auth, scopes: ["proxy:use"] };
      await expect(new AgentApiService(env, missingIntegration).authorize(integration)).rejects.toMatchObject({ code: "forbidden" });
      await repo.revoke(id, "actor");
      const upstream = vi.fn();
      vi.stubGlobal("fetch", upstream);
      await processProxyOperation(env, f.tenantId, operation.operationId);
      expect(upstream).not.toHaveBeenCalled();
      await expect(new AgentApiService(env, auth).read({ handle: operation.operationId, offset: 0 })).rejects.toMatchObject({ code: "invalid_token" });
    } finally {
      vi.unstubAllGlobals();
      await f.cleanup();
    }
  });
  it("serializes competing grants, preserves snapshots, and isolates management by team", async () => {
    const f = await loadingFixture(url!);
    try {
      const provider = crypto.randomUUID();
      const preset = crypto.randomUUID();
      await f.db.pool.query(
        "INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available) VALUES($1,$2,'fly','fly','Fly',true)",
        [f.tenantId, provider],
      );
      await f.db.pool.query(
        "INSERT INTO app.permission_presets(tenant_id,id,name,scopes) VALUES($1,$2,'Events',ARRAY['triggers:read'])",
        [f.tenantId, preset],
      );
      const auth = { ...f.auth, scopes: ["vms:edit", "triggers:read"] };
      await expect(resolveVmPermissions(f.db.pool, auth, { presetId: preset, scopes: ["triggers:read"] })).rejects.toMatchObject({ name: "ZodError" });
      const snapshot = await resolveVmPermissions(f.db.pool, auth, { presetId: preset });
      const repository = new VmGrantRepository(f.db.pool, f.tenantId);
      const unrelated = new VmGrantRepository(f.db.pool, f.otherTenant);
      const target = { provider_id: provider, provider_kind: "fly" as const, provider_epoch: 1, vm: "machine", vm_app: "app" };
      const reserve = (key: string) => repository.reserve(target, key, snapshot.scopes, snapshot.presetId, "actor");
      const results = await Promise.all([reserve("first"), reserve("second")]);
      const grants = results.filter(result => result.created);
      expect(grants).toHaveLength(1);
      const grant = grants[0]!.grant!;
      expect((await reserve(grant.request_key)).grant?.id).toBe(grant.id);
      expect(await repository.list()).toEqual([]);
      const identity = { machine_key: "verified-machine", issuer: "issuer", subject: "subject", public_key: { kty: "EC" } };
      expect(await repository.activate(grant.id, identity)).toMatchObject({ id: grant.id, revision: 1 });
      await f.db.pool.query("DELETE FROM app.permission_presets WHERE tenant_id=$1 AND id=$2", [f.tenantId, preset]);
      expect(await repository.list()).toMatchObject([{ id: grant.id, scopes: ["triggers:read"], preset_id: preset }]);
      expect(await unrelated.get(grant.id)).toBeUndefined();
      expect(await unrelated.revoke(grant.id, "other")).toBeUndefined();
      expect(await repository.replace(grant.id, 2, [], null, "actor")).toBeUndefined();
      expect(await repository.revoke(grant.id, "actor")).toMatchObject({ id: grant.id, revoked_at: expect.any(Date) });
      expect(await repository.replace(grant.id, 1, [], null, "actor")).toBeUndefined();
      expect(await repository.list()).toEqual([]);
      expect((await reserve("replacement")).grant?.id).not.toBe(grant.id);
    } finally {
      await f.cleanup();
    }
  });

  it("rejects whole requests outside current caller or integration policy", async () => {
    const f = await loadingFixture(url!);
    try {
      const integrationId = crypto.randomUUID();
      const scope = `integration:${integrationId}:1`;
      await f.db.pool.query(
        "INSERT INTO app.agent_integrations(tenant_id,id,kind,credential_id,name,available,policy) VALUES($1,$2,'fly','fly','Fly',true,'baseline')",
        [f.tenantId, integrationId],
      );
      await f.db.pool.query(
        "INSERT INTO app.agent_identities(tenant_id,kind,subject,user_id,session_version,disabled_scopes) VALUES($1,'oauth','client',$2,$3,ARRAY['triggers:write'])",
        [f.tenantId, f.userId, f.auth.sessionVersion],
      );
      const auth = { ...f.auth, authMethod: "oauth" as const, oauthGrantId: "client", oauthExpiresAt: Date.now() / 1000 + 300,
        scopes: ["vms:edit", "proxy:use", "triggers:read", "triggers:write"] };
      await expect(resolveVmPermissions(f.db.pool, { ...auth, oauthExpiresAt: 1 }, { scopes: ["triggers:read"] })).rejects.toMatchObject({ status: 403 });
      await expect(resolveVmPermissions(f.db.pool, auth, { scopes: ["triggers:read", "triggers:write"] })).rejects.toMatchObject({ status: 403 });
      expect(await resolveVmPermissions(f.db.pool, auth, { scopes: [scope, "triggers:read"] })).toEqual({ scopes: [scope, "triggers:read"], presetId: null });

      const repository = new VmGrantRepository(f.db.pool, f.tenantId);
      const vmScopes = ["vms:edit", "proxy:use", "triggers:read"];
      const target = { provider_id: integrationId, provider_kind: "fly" as const, provider_epoch: 1, vm: "machine", vm_app: "app" };
      const { grant } = await repository.reserve(target, "delegate", vmScopes, null, "oauth:client");
      await repository.activate(grant!.id, { machine_key: "machine", issuer: "issuer", subject: "subject", public_key: { kty: "EC" } });
      const vm = { ...auth, authMethod: "vm" as const, vmGrantId: grant!.id, vmTokenExpiresAt: auth.oauthExpiresAt, scopes: vmScopes };
      await expect(resolveVmPermissions(f.db.pool, vm, { scopes: [scope, "triggers:read"] })).rejects.toMatchObject({ status: 403 });
      expect(await resolveVmPermissions(f.db.pool, vm, { scopes: ["triggers:read"] })).toEqual({ scopes: ["triggers:read"], presetId: null });
      await f.db.pool.query("UPDATE app.agent_identities SET integration_overrides=$2 WHERE tenant_id=$1 AND subject='client'", [f.tenantId, { [integrationId]: false }]);
      const proceed = vi.fn(async () => undefined);
      await expect(writeVmPermissionSnapshot(f.db, auth, { scopes: ["triggers:read", scope] }, proceed)).rejects.toMatchObject({ status: 403 });
      expect(proceed).not.toHaveBeenCalled();
      expect(await repository.get(grant!.id)).toMatchObject({ scopes: vmScopes, revision: 1 });
      await f.db.pool.query("UPDATE app.agent_integrations SET epoch=2 WHERE tenant_id=$1 AND id=$2", [f.tenantId, integrationId]);
      await expect(resolveVmPermissions(f.db.pool, auth, { scopes: [scope] })).rejects.toMatchObject({ status: 403 });
      expect(await currentVmScopes(f.db.pool, f.tenantId, ["triggers:read", scope])).toEqual(["triggers:read"]);
      await f.db.pool.query("UPDATE app.agent_identities SET revoked_at=now() WHERE tenant_id=$1 AND subject='client'", [f.tenantId]);
      expect(await repository.list()).toMatchObject([{ id: grant!.id, scopes: vmScopes }]);
      await repository.revoke(grant!.id, "session:owner");
      await expect(resolveVmPermissions(f.db.pool, vm, { scopes: ["triggers:read"] })).rejects.toMatchObject({ status: 403 });
    } finally {
      await f.cleanup();
    }
  });
});
