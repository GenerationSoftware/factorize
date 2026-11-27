import { expect, it, vi } from "vitest";
import { HetznerSshService } from "../src/integrations/application/hetzner-ssh";
import { HetznerConnectionRepository } from "../src/credentials/storage/hetzner-connection-repository";
import { loadingFixture } from "./helpers/loading-fixture";

const url = process.env.AUTH_TEST_DATABASE_URL;

it.skipIf(!url)("enrolls only a verified project server, hides its private key and denies other or revoked clients", async () => {
  const f = await loadingFixture(url!);
  const selected = crypto.randomUUID(), other = crypto.randomUUID();
  const repository = new HetznerConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
  const auth = (client: string, scopes: string[]) => ({ ...f.auth, scopes, authMethod: "oauth" as const, oauthInstallationId: client, oauthGrantId: "test-" + client, oauthExpiresAt: Date.now()/1000 + 60 });
  const providerGet = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "https://api.hetzner.cloud/v1/servers?page=1&per_page=25") {
      return Response.json({ servers: [], meta: { pagination: { next_page: null } } });
    }
    expect(String(input)).toBe("https://api.hetzner.cloud/v1/servers/41");
    return Response.json({ server: { id: 41, public_net: { ipv4: {ip:"8.8.4.4"} } } });
  });
  vi.stubGlobal("fetch", providerGet);
  try {
    await repository.save("Fixture project", "synthetic-read-only-token");
    const { id, epoch } = (await f.db.pool.query("SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='hetzner'", [f.tenantId])).rows[0];
    const scope = `integration:${id}:${epoch}`;
    const fields = [f.tenantId, f.userId, selected, other, "test-" + selected, "test-" + other, f.auth.sessionVersion, [scope]];
    await f.db.pool.query(`INSERT INTO app.oauth_installations
      (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,active_scopes,selected_scopes)
      VALUES($1,$2,$3,'selected','https://local.example/callback',$5,$7,$8,$8),
            ($1,$2,$4,'other','https://local.example/callback',$6,$7,ARRAY['integrations:read'],ARRAY['integrations:read'])`, fields);

    const probe = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ tenantId:f.tenantId, ownerId:f.userId, authority:{ type:"oauth", installationId:selected, grantId:"test-" + selected, expiresAt:expect.any(Number), scope }, sessionVersion:f.auth.sessionVersion, serverId:41, version:expect.any(String) });
      return Response.json({ serverId:41, authenticated:true, reusedConnection:false });
    });
    f.env.HETZNER_SSH = { idFromName: vi.fn(value => value), get: () => ({ fetch: probe }) } as unknown as DurableObjectNamespace;
    const authorize = vi.fn(async () => {});
    const owner = new HetznerSshService(f.env, f.auth, authorize);
    const enrollment = { serverId:41, username:"fixture-check", hostFingerprint:"SHA256:" + "A".repeat(43) };
    const result = await owner.enroll(enrollment);
    expect(result).toEqual({...enrollment, publicKey:expect.stringMatching(/^ssh-ed25519 /)});
    expect(await owner.list()).toEqual({ servers:[result] });
    const encrypted = await f.db.pool.query("SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind='hetzner-ssh:41'", [f.tenantId]);
    expect(encrypted.rows[0].encrypted_value).not.toContain(result.publicKey);
    await expect(owner.checkAsClient(41)).rejects.toMatchObject({status:403});
    const unapproved = new HetznerSshService(f.env, auth(other, ["integrations:read"]), authorize);
    await expect(unapproved.checkAsClient(41)).rejects.toMatchObject({status:403});
    await expect(unapproved.inventoryAsClient()).rejects.toMatchObject({status:403});
    expect(probe).not.toHaveBeenCalled();

    const approved = new HetznerSshService(f.env, auth(selected, []), authorize);
    expect(await approved.inventoryAsClient()).toEqual({ servers: [], truncated: false });
    expect(await approved.checkAsClient(41)).toEqual({serverId:41,authenticated:true,reusedConnection:false});
    expect(providerGet).toHaveBeenCalledTimes(2); // The internal broker, not the browser/MCP caller, performs the preflight lookup.
    await f.db.pool.query("UPDATE app.oauth_installations SET selected_scopes='{}' WHERE tenant_id=$1 AND id=$2", [f.tenantId,selected]);
    await expect(approved.checkAsClient(41)).rejects.toMatchObject({status:403});
    expect(probe).toHaveBeenCalledOnce();
    expect(await owner.delete(41)).toEqual({deleted:true});
    expect(await owner.list()).toEqual({servers:[]});
    const before = epoch;
    await repository.delete();
    await repository.save("Replacement project", "other-synthetic-token");
    expect((await f.db.pool.query("SELECT epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='hetzner'", [f.tenantId])).rows[0].epoch).toBeGreaterThan(before);
    await expect(approved.checkAsClient(41)).rejects.toMatchObject({status:403});
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});
