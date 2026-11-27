import { expect, it, vi } from "vitest";
import { loadingFixture } from "./helpers/loading-fixture";
import { protectedApiFetch } from "../src/protected-api";
import worker from "../src/worker";
import type { OAuthProps } from "../src/types";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
const url = process.env.AUTH_TEST_DATABASE_URL;
const ctx = { waitUntil() {} } as unknown as ExecutionContext;

it.skipIf(!url)("provisions one bounded server per request and binds its SSH key to the exact OAuth installation", async () => {
  const f = await loadingFixture(url!);
  const origin = f.env.APP_ORIGIN;
  const selected = crypto.randomUUID(), other = crypto.randomUUID(), unapproved = crypto.randomUUID();
  const agent = (id = selected): OAuthProps => ({...f.auth, scopes: [], authMethod: "oauth", oauthInstallationId: id,
    oauthClientId: "same-app", oauthGrantId: "grant-" + id, oauthExpiresAt: Date.now()/1000 + 60});
  const api = (path: string, method = "GET", body?: object) => worker.fetch(new Request(origin + "/api/v1/hetzner" + path, {
    method, headers: { Cookie: f.cookie, Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), f.env, ctx);
  const mcp = async (name: string, args: object = {}, auth = agent()) => {
    const response = await protectedApiFetch(new Request(origin + "/mcp", { method: "POST", headers: {
      Host: new URL(origin).host, "Mcp-Protocol-Version": "2025-11-25", "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), f.env, auth, ctx);
    const message = await response.text();
    const payload = message.startsWith("event:") ? message.split("\n").find(line => line.startsWith("data:"))?.slice(5) : message;
    return JSON.parse(payload ?? "{}");
  };
  const assign = async (ids: string[]) => {
    const { id, epoch } = (await f.db.pool.query("SELECT id,epoch FROM app.agent_integrations WHERE tenant_id=$1 AND kind='hetzner'", [f.tenantId])).rows[0];
    await f.db.pool.query("UPDATE app.oauth_installations SET selected_scopes=$3 WHERE tenant_id=$1 AND id=ANY($2)", [f.tenantId,ids,[`integration:${id}:${epoch}`]]);
  };
  const approvals = { accepted: 0, reads: 0, nonce: "", publicKey: "" };
  const fixtureId = 41;
  const provider = vi.fn<typeof fetch>(async (value, init) => {
    const url = new URL(String(value));
    const token = new Headers(init?.headers).get("Authorization");
    expect(url.origin).toBe("https://api.hetzner.cloud");
    expect(init?.redirect).toBe("manual");
    if (init?.method === "POST") {
      approvals.accepted++;
      expect(url.pathname + url.search).toBe("/v1/servers");
      expect(token).toBe("Bearer syntheticWriteToken");
      const payload = JSON.parse(String(init.body));
      expect(payload).toMatchObject({name:"test-inventory", server_type:"cx23", location:"fsn1", image:"ubuntu-24.04",
        start_after_create:true, public_net:{enable_ipv4:true,enable_ipv6:false}});
      expect(payload).not.toHaveProperty("ssh_keys");
      expect(payload).not.toHaveProperty("volumes");
      expect(payload.user_data).toMatch(/^#cloud-config\n/);
      expect(JSON.parse(payload.user_data.split("\n")[1])).toEqual({
        disable_root:true, ssh_pwauth:false, allow_public_ssh_keys:false, ssh_genkeytypes:["ed25519"], users:[{name:"factorize-agent",shell:"/bin/sh",lock_passwd:true,sudo:null,
          ssh_authorized_keys:[`restrict,command="/bin/true" ${approvals.publicKey}`]}],
      });
      approvals.nonce = payload.labels["factorize-request"];
      expect(approvals.nonce).not.toBe(selected);
      return new Response("synthetic upstream details", { status: 503 });
    }
    expect(init?.method).toBe("GET");
    if (url.searchParams.has("label_selector")) {
      approvals.reads++;
      expect(url.searchParams.get("label_selector")).toBe("factorize-request=" + approvals.nonce);
      expect(url.searchParams.get("name")).toBe("test-inventory");
      return Response.json({ servers: [{id:fixtureId,name:"test-inventory",labels:{"factorize-request":approvals.nonce}, root_password:"private"}] });
    }
    if (url.pathname === "/v1/servers/41") return Response.json({ server: { id: fixtureId, public_net: { ipv4: { ip: "8.8.4.4" } } } });
    return Response.json({servers:[],meta:{pagination:{next_page:null}}});
  });
  vi.stubGlobal("fetch", provider);
  try {
    for (const id of [selected,other,unapproved]) {
      await f.db.pool.query(`INSERT INTO app.oauth_installations
        (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version) VALUES($1,$2,$3,'same-app','https://example.test',$4,$5)`,
      [f.tenantId,f.userId,id,"grant-"+id,f.auth.sessionVersion]);
    }
    await api("/connection","PUT",{ name:"Cloud", token:"syntheticReadToken" });
    await assign([selected,other]);
    const input = {requestId:crypto.randomUUID(),name:"test-inventory",serverType:"cx23",location:"fsn1"};
    expect(JSON.stringify(await mcp("create_hetzner_server", input))).toContain("hetzner_provisioning_disabled");
    expect(JSON.stringify(await mcp("list_hetzner_servers"))).toContain("servers");
    expect(approvals.accepted).toBe(0);
    const connection = await api("/connection","PUT",{ name:"Cloud", token:"syntheticWriteToken", provisioningEnabled:true });
    expect(await connection.json()).toEqual({ connection:{ name:"Cloud",provisioningEnabled:true } });
    expect(JSON.stringify(await mcp("create_hetzner_server", input))).toContain("hetzner_not_authorized");
    await assign([selected,other]);
    expect(JSON.stringify(await mcp("get_hetzner_ssh_public_key", {}, agent(unapproved)))).toContain("hetzner_not_authorized");
    const first = (await mcp("get_hetzner_ssh_public_key")).result.structuredContent;
    const second = (await mcp("get_hetzner_ssh_public_key", {}, agent(other))).result.structuredContent;
    expect(first.publicKey).toMatch(/^ssh-ed25519 /);
    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.privateKey).toBeUndefined();
    expect((await mcp("get_hetzner_ssh_public_key")).result.structuredContent).toEqual(first);
    approvals.publicKey = first.publicKey;
    expect(JSON.stringify(await mcp("create_hetzner_server", {...input, userData: "not allowed"}))).not.toContain("created");
    expect(approvals.accepted).toBe(0);
    const uncertain = JSON.stringify(await mcp("create_hetzner_server",input));
    expect(uncertain).toContain("hetzner_create_unconfirmed");
    expect(uncertain).not.toMatch(/synthetic upstream details|syntheticWriteToken/);
    const result = (await mcp("create_hetzner_server",input)).result.structuredContent;
    expect(result).toMatchObject({state:"created", serverId:fixtureId, ssh:"owner_pin_required"});
    expect((await mcp("create_hetzner_server",input)).result.structuredContent).toEqual(result);
    expect(JSON.stringify(await mcp("create_hetzner_server",{...input,location:"nbg1"}))).toContain("hetzner_request_conflict");
    expect(JSON.stringify(await mcp("create_hetzner_server",{...input,requestId:crypto.randomUUID()},agent(other)))).toContain("hetzner_name_reserved");
    expect(approvals).toMatchObject({ accepted:1,reads:1 });
    const pin = {serverId:fixtureId,username:"factorize-agent",hostFingerprint:"SHA256:" + "A".repeat(43)};
    expect((await api("/ssh","POST",{...pin,clientInstallationId:other})).status).toBe(400);
    const enrollment = await api("/ssh","POST",pin);
    expect(await enrollment.json()).toMatchObject({...pin, clientInstallationId:selected,publicKey:first.publicKey});
    expect(JSON.stringify(await mcp("check_hetzner_ssh", {serverId:fixtureId}, agent(other)))).toContain("ssh_target_not_found");
    await f.db.pool.query("UPDATE app.oauth_installations SET selected_scopes='{}' WHERE tenant_id=$1 AND id=$2", [f.tenantId,selected]);
    expect(JSON.stringify(await mcp("create_hetzner_server",input))).toContain("hetzner_not_authorized");
    const encrypted = await f.db.pool.query("SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind LIKE 'hetzner-client-key:%'",[f.tenantId]);
    expect(encrypted.rows).toHaveLength(2);
    expect(JSON.stringify(encrypted.rows)).not.toContain(first.publicKey);
    expect(approvals.accepted).toBe(1);
  } finally { vi.unstubAllGlobals(); await f.cleanup(); }
});
