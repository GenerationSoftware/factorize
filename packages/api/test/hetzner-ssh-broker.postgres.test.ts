import { expect, it, vi } from "vitest";
import { HetznerSshBroker } from "../src/integrations/providers/hetzner-ssh-broker";
import { HetznerSshService } from "../src/integrations/application/hetzner-ssh";
import { HetznerConnectionRepository } from "../src/credentials/storage/hetzner-connection-repository";
import { authenticateHetznerSsh } from "../src/integrations/providers/hetzner-ssh-transport";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(_ctx: unknown, public env: unknown) {} } }));
vi.mock("../src/integrations/providers/hetzner-ssh-transport", async importOriginal => ({
  ...await importOriginal<object>(), authenticateHetznerSsh: vi.fn(async () => {}),
}));

const url = process.env.AUTH_TEST_DATABASE_URL;
it.skipIf(!url)("rechecks the project and exact OAuth authority at the SSH broker before dialing", async () => {
  const f = await loadingFixture(url!);
  const selected = crypto.randomUUID(), grant = "test-current-grant";
  const repository = new HetznerConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
  let address = "8.8.4.4", status = 200;
  const providerGet = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://api.hetzner.cloud/v1/servers/41");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-read-only-token");
    return status === 200 ? Response.json({ server: { id: 41, public_net: { ipv4: { ip: address } } } }) : new Response(null, { status });
  });
  vi.stubGlobal("fetch", providerGet);
  try {
    await repository.save("Fixture project", "synthetic-read-only-token");
    await f.db.pool.query(`INSERT INTO app.oauth_installations
      (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,active_scopes,selected_scopes)
      VALUES($1,$2,$3,'selected','https://local.example/callback',$4,$5,ARRAY['integrations:read'],ARRAY['integrations:read'])`,
    [f.tenantId, f.userId, selected, grant, f.auth.sessionVersion]);
    const authorize = async () => {};
    const owner = new HetznerSshService(f.env, f.auth, authorize, authorize);
    const broker = new HetznerSshBroker({} as DurableObjectState, f.env);
    const dispatch = (url: string, init: RequestInit) => broker.fetch(new Request(url, init));
    f.env.HETZNER_SSH = { idFromName: (value: string) => value, get: () => ({ fetch: dispatch }) } as unknown as DurableObjectNamespace;
    await owner.enroll({ serverId: 41, username: "fixture-check", hostFingerprint: "SHA256:" + "A".repeat(43), clientInstallationId: selected });
    const auth = { ...f.auth, authMethod: "oauth" as const, oauthInstallationId: selected, oauthGrantId: grant, oauthExpiresAt: Date.now()/1000 + 60 };
    const caller = new HetznerSshService(f.env, auth, authorize, authorize);
    expect(await caller.checkAsClient(41)).toEqual({ serverId: 41, authenticated: true, reusedConnection: false });
    expect(providerGet).toHaveBeenCalledTimes(2);
    expect(authenticateHetznerSsh).toHaveBeenCalledTimes(1);
    address = "8.8.8.8";
    await expect(caller.checkAsClient(41)).rejects.toMatchObject({code:"ssh_check_failed"});
    address = "8.8.4.4"; status = 404;
    await expect(caller.checkAsClient(41)).rejects.toMatchObject({code:"ssh_check_failed"});
    status = 401;
    await expect(caller.checkAsClient(41)).rejects.toMatchObject({code:"ssh_check_failed"});
    expect(providerGet).toHaveBeenCalledTimes(5);
    expect(authenticateHetznerSsh).toHaveBeenCalledTimes(1);
    await owner.delete(41);
    await expect(caller.checkAsClient(41)).rejects.toMatchObject({code:"ssh_target_not_found"});
    expect(authenticateHetznerSsh).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});
