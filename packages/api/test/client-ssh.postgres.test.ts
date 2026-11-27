import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { HetznerConnectionRepository } from "../src/credentials/storage/hetzner-connection-repository";
import { SshClientKeyRepository } from "../src/credentials/storage/ssh-client-key-repository";
import { generateHetznerSshKey } from "../src/integrations/providers/hetzner-ssh-transport";
import worker from "../src/worker";
import type { OAuthProps } from "../src/types";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const url = process.env.AUTH_TEST_DATABASE_URL;
const ctx = { waitUntil() {} } as unknown as ExecutionContext;

it.skipIf(!url)("keeps a separate client key across OAuth and project changes and restricts target management to the owner session", async () => {
  const f = await loadingFixture(url!);
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const auth = (id = first, grant = "grant-" + id): OAuthProps => ({ ...f.auth, scopes: [], authMethod: "oauth",
    oauthInstallationId: id, oauthClientId: "same-app", oauthGrantId: grant, oauthExpiresAt: Date.now() / 1000 + 120 });
  const mcp = mcpRequest(f.env, auth());
  const invoke = async (name: string, args: object = {}, identity = auth()) =>
    (await mcp("tools/call", { name, arguments: args }, identity)).message.result;
  const ownerRequest = (path: string, method: string, body?: object) => worker.fetch(new Request(f.env.APP_ORIGIN + path, {
    method, headers: { Cookie:f.cookie, Origin:f.env.APP_ORIGIN, "Content-Type":"application/json" },
    ...(body ? { body:JSON.stringify(body) } : {}),
  }), f.env, ctx);
  const legacyKey = generateHetznerSshKey();
  const db = f.db.pool;
  try {
    for (const id of [first, second]) await db.query(`INSERT INTO app.oauth_installations
      (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,active_scopes,selected_scopes)
      VALUES($1,$2,$3,'same-app','https://example.test',$4,$5,ARRAY[]::text[],ARRAY[]::text[])`,
      [f.tenantId,f.userId,id,"grant-"+id,f.auth.sessionVersion]);
    const repo = new SshClientKeyRepository(f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    await repo.getOrCreate(db, first, () => legacyKey);
    await db.query("UPDATE app.connections SET kind=$3 WHERE tenant_id=$1 AND kind=$2", [f.tenantId, "ssh-client-key:"+first, "hetzner-client-key:"+first]);
    const migration = await readFile(new URL("../migrations/0121_ssh_client_identity.sql", import.meta.url), "utf8");
    // Scope this migration assertion to the isolated fixture tenant.
    await db.query(migration.replace("FROM app.connections WHERE kind LIKE", "FROM app.connections WHERE tenant_id=$1 AND kind LIKE"), [f.tenantId]);
    const tools = (await mcp("tools/list", {})).message.result;
    expect(tools.tools).toEqual(expect.arrayContaining([expect.objectContaining({name:"get_ssh_public_key"}), expect.objectContaining({name:"ssh_exec"})]));
    const getKey = async (identity = auth()) => JSON.stringify(await invoke("get_ssh_public_key", {}, identity) ?? null);
    const original = await getKey();
    expect(original).toContain(legacyKey.publicKey);
    expect(original).not.toContain("PRIVATE KEY");
    const other = await getKey(auth(second));
    expect(other).toContain("ssh-ed25519");
    expect(other).not.toContain(legacyKey.publicKey);

    await db.query("UPDATE app.oauth_installations SET active_grant_id=$4 WHERE tenant_id=$1 AND user_id=$2 AND id=$3",
      [f.tenantId, f.userId, first, "new-grant"]);
    const reconnected = auth(first, "new-grant");
    expect(await getKey(reconnected)).toBe(original);
    expect(await getKey()).not.toContain(legacyKey.publicKey);

    const project = new HetznerConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    await project.save("First test project", "synthetic-project-token");
    await project.save("Replacement test project", "synthetic-replacement-token");
    expect(await getKey(reconnected)).toBe(original);
    expect(await project.delete()).toBe(true);
    expect(await getKey(reconnected)).toBe(original);
    expect(await repo.get(db, first)).toEqual(legacyKey);

    const config = { name:"Test", address:"8.8.4.4", username:"runner", hostFingerprint:"SHA256:"+"A".repeat(43) };
    for (const bad of [{...config,address:"127.0.0.1"},{...config,username:"root"}])
      expect((await ownerRequest("/api/v1/ssh/targets","POST",bad)).status).toBe(400);
    const saved = await ownerRequest("/api/v1/ssh/targets","POST",config);
    expect(saved.status).toBe(200);
    const target = await saved.json() as { id:string };
    expect(target.id).toBeTruthy();
    const list = await ownerRequest("/api/v1/ssh/targets","GET");
    expect(await list.json()).toEqual({targets:[{...config,id:target.id}]});

    f.env.CLIENT_SSH = { idFromName: (value: string) => value, get: (key: string) => ({
      fetch: async (_url: string, request: RequestInit) => {
        const body = JSON.parse(String(request.body));
        expect(JSON.parse(key)).toEqual([f.tenantId, f.userId, first, target.id]);
        expect(body.authority.oauthGrantId).toBe("new-grant");
        expect(body.authority.oauthInstallationId).toBe(first);
        expect(body.command).toBe("ls");
        expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
        return Response.json({ stdout:"workspace\n", stderr:"", exitCode:0, signal:null, reusedConnection:true, truncated:false });
      },
    }) } as unknown as DurableObjectNamespace;
    expect(JSON.stringify(await invoke("ssh_exec", {targetId:target.id,command:"ls"}, reconnected))).toContain("workspace");
    expect((await ownerRequest("/api/v1/ssh/targets/" + target.id,"DELETE")).status).toBe(200);
  } finally {
    await f.cleanup();
  }
});
