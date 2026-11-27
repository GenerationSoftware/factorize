import { expect, it, vi } from "vitest";
import { HetznerConnectionRepository } from "../src/credentials/storage/hetzner-connection-repository";
import { requiredIntegrationScope, type AgentIntegration } from "../src/proxy/application/agent-integration-access";
import { SshExecBroker } from "../src/ssh/transport/exec-broker";
import { SshHostFingerprintMismatch, openSshSession, execBounded } from "../src/ssh/transport/edgeport-exec";
import worker from "../src/worker";
import type { Env, OAuthProps } from "../src/types";
import { loadingFixture } from "./helpers/loading-fixture";
import { mcpRequest } from "./helpers/mcp-request";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {}, WorkflowEntrypoint: class {},
  DurableObject: class { constructor(readonly ctx: DurableObjectState, readonly env: Env) {} },
}));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("../src/ssh/transport/edgeport-exec", () => ({
  openSshSession: vi.fn(), execBounded: vi.fn(),
  SSH_COMMAND_MS: 1_000, SSH_CONNECT_MS: 1_000, SshHostFingerprintMismatch: class extends Error {},
}));
const url = process.env.AUTH_TEST_DATABASE_URL;
const ctx = { waitUntil() {} } as unknown as ExecutionContext;

it.skipIf(!url)("resolves Hetzner IDs under the live project grant and fences a changed host pin until explicitly verified again", async () => {
  const f = await loadingFixture(url!);
  const installation = crypto.randomUUID(), grant = "grant-" + installation, serverId = 987;
  const identity: OAuthProps = { ...f.auth, scopes: ["proxy:use"], authMethod: "oauth",
    oauthInstallationId: installation, oauthClientId: "test-app", oauthGrantId: grant, oauthExpiresAt: Date.now() / 1000 + 120 };
  const mcp = mcpRequest(f.env, identity);
  const ownerRequest = (path: string, method: string, body?: object) => worker.fetch(new Request(f.env.APP_ORIGIN + path, {
    method, headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), f.env, ctx);
  const path = "/api/v1/ssh/hetzner-targets";
  const pin = { username: "runner", hostFingerprint: "SHA256:" + "A".repeat(43) };
  const brokers = new Map<string, SshExecBroker>();
  f.env.CLIENT_SSH = { idFromName: (id: string) => id, get: (id: string) => {
    if (!brokers.has(id)) brokers.set(id, new SshExecBroker({ id, waitUntil() {} } as unknown as DurableObjectState, f.env));
    return { fetch: (input: string, init: RequestInit) => brokers.get(id)!.fetch(new Request(input, init)) };
  } } as unknown as DurableObjectNamespace;
  let address = "8.8.4.4", missing = false;
  const provider = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(new URL(req.url).origin).toBe("https://api.hetzner.cloud");
    expect(new URL(req.url).pathname).toBe("/v1/servers/" + serverId);
    if (missing) return new Response(null, { status: 404 });
    return Response.json({ server: { id: serverId, public_net: { ipv4: { ip: address } } } });
  });
  const session = { close: vi.fn(async () => {}) };
  vi.mocked(openSshSession).mockResolvedValue(session as unknown as Awaited<ReturnType<typeof openSshSession>>);
  vi.mocked(execBounded).mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, signal: null, truncated: false });
  vi.stubGlobal("fetch", provider);
  const run = async (params: object = { hetznerServerId: serverId }) =>
    JSON.stringify((await mcp("tools/call", { name: "ssh_exec", arguments: { command: "true", ...params } })).message);
  try {
    const project = new HetznerConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY);
    await project.save("Project", "synthetic-test-token");
    const row = (await f.db.pool.query<AgentIntegration>("SELECT * FROM app.agent_integrations WHERE tenant_id=$1 AND kind='hetzner'", [f.tenantId])).rows[0]!;
    const scope = requiredIntegrationScope(row);
    const db = f.db.pool;
    await db.query(`INSERT INTO app.oauth_installations
      (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,active_scopes,selected_scopes)
      VALUES($1,$2,$3,'test-app','https://example.test',$4,$5,ARRAY['proxy:use'],ARRAY['proxy:use'])`,
      [f.tenantId,f.userId,installation,grant,f.auth.sessionVersion]);
    const setAccess = (granted: boolean) => db.query(`UPDATE app.oauth_installations SET selected_scopes=$3
      WHERE tenant_id=$1 AND id=$2`, [f.tenantId, installation, granted ? ["proxy:use", scope] : ["proxy:use"]]);

    expect(await run()).toContain("hetzner_ssh_access_denied");
    expect(provider).not.toHaveBeenCalled();
    await setAccess(true);
    expect(await run()).toContain("ssh_host_unverified");
    expect(provider).not.toHaveBeenCalled();
    expect(await run({})).not.toContain('"stdout"');
    expect(await run({ hetznerServerId: serverId, targetId: crypto.randomUUID() })).not.toContain('"stdout"');
    await mcp("tools/call", { name: "get_ssh_public_key", arguments: {} });

    expect((await ownerRequest(path + "/" + serverId, "PUT", pin)).status).toBe(200);
    expect(await (await ownerRequest(path, "GET")).json()).toEqual({ targets: [{...pin, serverId, needsVerification: false}] });
    expect(await run()).toContain('"stdout":"ok"');
    expect(vi.mocked(openSshSession).mock.calls[0]?.[0]).toMatchObject({ address, username: pin.username, hostFingerprint: pin.hostFingerprint });

    // Hetzner reassigns its public address. Do not use the old warm connection.
    address = "8.8.8.8";
    vi.mocked(openSshSession).mockRejectedValueOnce(new SshHostFingerprintMismatch());
    expect(await run()).toContain("ssh_host_fingerprint_changed");
    expect(session.close).toHaveBeenCalled();
    expect(execBounded).toHaveBeenCalledTimes(1);
    expect(await run()).toContain("ssh_host_unverified");
    expect(openSshSession).toHaveBeenCalledTimes(2);
    expect(await (await ownerRequest(path, "GET")).json()).toEqual({ targets: [{...pin, serverId, needsVerification: true}] });

    const verified = { ...pin, hostFingerprint: "SHA256:" + "B".repeat(43) };
    expect((await ownerRequest(path + "/" + serverId, "PUT", verified)).status).toBe(200);
    expect(await run()).toContain('"stdout":"ok"');
    expect(vi.mocked(openSshSession).mock.calls[2]?.[0]).toMatchObject({ address, hostFingerprint: verified.hostFingerprint });
    missing = true;
    expect(await run()).toContain("hetzner_ssh_lookup_failed");
    expect(execBounded).toHaveBeenCalledTimes(2);
    await setAccess(false);
    expect(await run()).toContain("hetzner_ssh_access_denied");
    await project.save("Replacement", "synthetic-replacement");
    expect(await (await ownerRequest(path, "GET")).json()).toEqual({ targets: [] });
  } finally {
    vi.unstubAllGlobals();
    await f.cleanup();
  }
});
