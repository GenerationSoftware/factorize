import { example } from "./helpers/docs-example";
import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FlyConnectionRepository } from "../src/credentials/storage/fly-connection-repository";
import { VmGrantRepository } from "../src/vm-grants/storage/vm-grant-repository";
import { provisionVmGrant } from "../src/vm-grants/application/vm-enrollment";
import { requireVmGrantProvider } from "../src/vm-grants/application/vm-grant-provider";
import { loadingFixture } from "./helpers/loading-fixture";
import worker from "../src/worker";
import { vmGrantAudience } from "../src/vm-grants/application/vm-grant-provider";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {}, WorkflowEntrypoint: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
const issuer = "https://oidc.fly.io/example";
const origin = "https://api.machines.dev/v1/apps/demo";
const machine = origin + "/machines/1234abcd";
const vendorKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const guest = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function flyToken(audience: string, machineId = "1234abcd") {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = base64url({ alg: "RS256", kid: "current" }) + "." + base64url({
    iss: issuer, sub: "example:demo:workload", aud: audience, machine_id: machineId, iat: now, exp: now + 300,
  });
  return unsigned + "." + sign("RSA-SHA256", Buffer.from(unsigned), vendorKey.privateKey).toString("base64url");
}

function requestProof(grant: string, token: string, method: string, target: string) {
  const unsigned = base64url({ alg: "ES256", typ: "factorize-vm-proof+jwt" }) + "." + base64url({
    grant, htm: method, htu: target, ath: createHash("sha256").update(token).digest("base64url"),
    iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(),
  });
  return unsigned + "." + sign("sha256", Buffer.from(unsigned), {
    key: guest.privateKey, dsaEncoding: "ieee-p1363",
  }).toString("base64url");
}

describe("VM grant provider support", () => {
  it("supports Fly.io without deployment configuration and keeps exe.dev disabled", () => {
    expect(() => requireVmGrantProvider("fly")).not.toThrow();
    expect(() => requireVmGrantProvider("exe")).toThrow("unavailable");
  });
});

describe.skipIf(!url)("Fly permission enrollment", () => {
  it("denies over-delegation and verifies the provider before activating a retry", async () => {
    const f = await loadingFixture(url!);
    try {
      await new FlyConnectionRepository(f.db, f.tenantId, f.env.CREDENTIAL_ENCRYPTION_KEY).save({
        organizationSlug: "example", organizationName: "Example",
      }, "fixture-token");
      const providerId = (await f.db.pool.query<{ id: string }>(
        "SELECT id FROM app.agent_integrations WHERE tenant_id=$1 AND kind='fly'", [f.tenantId],
      )).rows[0]!.id;
      const env = f.env;
      const auth = { ...f.auth, scopes: ["vms:edit", "vms:read", "team:read", "triggers:read"] };
      const recipe = await example("vm-access", "grant_vm_permissions");
      const { kind: _fixtureKind, ...fixtureTarget } = recipe.target;
      const input = { ...fixtureTarget, providerId, app: "demo", permissions: { scopes: [...recipe.permissions.scopes, "vms:read", "team:read"] } };
      let organization = "wrong";
      let failDiscovery = true;
      const attemptedIds: string[] = [];
      const provider = vi.fn<typeof fetch>(async (request, init) => {
        switch (String(request)) {
          case origin: return Response.json({ name: "demo", organization: { slug: organization } });
          case machine: return Response.json({ id: "1234abcd", name: "workload", state: "started" });
          case machine + "/exec": {
            const args = JSON.parse(String(init?.body)).command;
            const [, , , , id, challenge, audience] = args;
            attemptedIds.push(id);
            const publicKey = guest.publicKey.export({ type: "spki", format: "der" }).toString("base64");
            const proof = sign("sha256", Buffer.from(challenge), guest.privateKey).toString("base64");
            const response = Buffer.from(flyToken(audience)).toString("base64");
            return Response.json({ stdout: [publicKey, proof, response].join("\n"), exit_code: 0 });
          }
          case issuer + "/.well-known/openid-configuration":
            return failDiscovery ? new Response(null, { status: 503 }) : Response.json({ issuer, jwks_uri: issuer + "/keys" });
          case issuer + "/keys":
            return Response.json({ keys: [{ ...vendorKey.publicKey.export({ format: "jwk" }), kid: "current" }] });
          default:
            throw new Error("Unexpected provider route");
        }
      });
      vi.stubGlobal("fetch", provider);
      await expect(provisionVmGrant(env, auth, { ...input, permissions: { scopes: ["vms:read", "triggers:write"] } })).rejects.toMatchObject({ status: 403 });
      expect(provider).not.toHaveBeenCalled();
      await expect(provisionVmGrant(env, auth, input)).rejects.toMatchObject({ code: "vm_verification_failed" });
      expect(attemptedIds).toEqual([]);

      organization = "example";
      await expect(provisionVmGrant(env, auth, input)).rejects.toMatchObject({ code: "vm_verification_failed" });
      const repository = new VmGrantRepository(f.db.pool, f.tenantId);
      expect(await repository.list()).toEqual([]);
      failDiscovery = false;
      const active = await provisionVmGrant(env, auth, input);
      expect(attemptedIds).toEqual([active.id, active.id]);
      expect(active).toMatchObject({ scopes: ["triggers:read", "vms:read", "team:read"], issuer, machine_key: "example/demo/1234abcd" });
      expect(active.public_key).not.toHaveProperty("d");
      expect(await repository.list()).toHaveLength(1);
      expect((await provisionVmGrant(env, auth, input)).id).toBe(active.id);
      expect(attemptedIds).toEqual([active.id, active.id]);

      const token = flyToken(vmGrantAudience(active.id));
      const invoke = (path: string, proof?: string, bearer = token, tool?: { name: string; arguments: unknown }, grantId = active.id) => {
        const isMcp = path === "/mcp";
        const method = tool ? "tools/call" : "tools/list";
        return worker.fetch(new Request(f.env.APP_ORIGIN + path, {
          method: isMcp ? "POST" : "GET",
          headers: {
            Authorization: "Bearer " + bearer, "X-Factorize-VM-Grant": grantId, Cookie: f.cookie,
            ...(proof ? { "X-Factorize-VM-Proof": proof } : {}),
            ...(isMcp ? { "Mcp-Method": method, Host: "factorize.test", "Content-Type": "application/json", Accept: "application/json, text/event-stream" } : {}),
            ...(tool ? { "Mcp-Name": tool.name } : {}),
          },
          body: isMcp ? JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: tool ?? {} }) : undefined,
        }), env, { waitUntil() {} } as unknown as ExecutionContext);
      };
      for (const [path, method] of [["/api/v1/team", "GET"], ["/mcp", "POST"]]) {
        const proofFor = (target = path!, bearer = token) => requestProof(active.id, bearer, method!, f.env.APP_ORIGIN + target);
        expect((await invoke(path!)).status).toBe(401);
        expect((await invoke(path!, proofFor("/unexpected"))).status).toBe(401);
        expect((await invoke(path!, proofFor(path, "another-token"))).status).toBe(401);
        const peerToken = flyToken(vmGrantAudience(active.id), "same-name-peer");
        expect((await invoke(path!, proofFor(path, peerToken), peerToken)).status).toBe(401);
        const proof = proofFor();
        const results = await Promise.all([invoke(path!, proof), invoke(path!, proof)]);
        expect(results.map(result => result.status).sort()).toEqual([200, 401]);
        expect((await invoke(path!, proof)).status).toBe(401);
      }
      const listPath = "/api/v1/vms";
      const listResponse = await invoke(listPath, requestProof(active.id, token, "GET", f.env.APP_ORIGIN + listPath));
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toMatchObject([{ id: active.id, scopes: ["triggers:read", "vms:read", "team:read"] }]);
      const mcp = (tool: { name: string; arguments: unknown }) => invoke("/mcp", requestProof(active.id, token, "POST", f.env.APP_ORIGIN + "/mcp"), token, tool);
      expect(await (await mcp({ name: "list_vms", arguments: {} })).text()).toContain(active.id);
      expect((await mcp({ name: "list_events", arguments: {} })).status).toBe(200);
      const eventPath = "/api/v1/events";
      const events = await invoke(eventPath, requestProof(active.id, token, "GET", f.env.APP_ORIGIN + eventPath));
      expect(events.status).toBe(200);
      expect(await events.json()).toEqual([]);

      expect(await (await mcp({ name: "revoke_vm_permissions", arguments: { grantId: active.id } })).text()).toContain("insufficient_scope");

      const sessionRequest = (path: string, method: string, body?: unknown) => worker.fetch(new Request(f.env.APP_ORIGIN + path, {
        method, headers: { Cookie: f.cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), env, { waitUntil() {} } as unknown as ExecutionContext);
      const edit = { target: { kind: "existing", grantId: active.id, expectedRevision: 1 }, permissions: { scopes: ["vms:read"] } };
      expect((await sessionRequest("/api/v1/vms/grants", "POST", edit)).status).toBe(200);
      expect((await sessionRequest("/api/v1/vms/grants", "POST", edit)).status).toBe(409);
      expect((await sessionRequest("/api/v1/vms/grants/" + active.id, "DELETE")).status).toBe(200);
      expect((await invoke("/api/v1/team", requestProof(active.id, token, "GET", f.env.APP_ORIGIN + "/api/v1/team"))).status).toBe(401);
      expect((await invoke("/mcp", requestProof(active.id, token, "POST", f.env.APP_ORIGIN + "/mcp"))).status).toBe(401);

      const target = { kind: "machine", providerId, vm: input.vm, app: input.app, requestKey: "replacement" };
      const permissions = { scopes: ["vms:edit", "vms:read", "team:read"] };
      const replacement = await sessionRequest("/api/v1/vms/grants", "POST", { target, permissions });
      expect(replacement.status).toBe(200);
      const next = await replacement.json() as { id: string };
      expect(next.id).not.toBe(active.id);
      const mcpUrl = f.env.APP_ORIGIN + "/mcp";
      expect((await invoke("/mcp", requestProof(next.id, token, "POST", mcpUrl), token, undefined, next.id)).status).toBe(401);
      const nextToken = flyToken(vmGrantAudience(next.id));
      const call = async (name: string, args: unknown) => (await invoke("/mcp", requestProof(next.id, nextToken, "POST", mcpUrl),
        nextToken, { name, arguments: args }, next.id)).text();
      const nextTarget = { kind: "existing", grantId: next.id, expectedRevision: 1 };
      expect(await call("grant_vm_permissions", { target: nextTarget, permissions: { scopes: ["vms:read", "triggers:write"] } })).toContain("forbidden");
      expect(await call("grant_vm_permissions", { target: nextTarget, permissions: { scopes: ["vms:edit", "vms:read"] } })).not.toContain("isError");
      expect(await repository.get(next.id)).toMatchObject({ revision: 2, scopes: ["vms:edit", "vms:read"] });
      expect(await call("revoke_vm_permissions", { grantId: next.id })).toContain("revoked");
      expect(await repository.list()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await f.cleanup();
    }
  });
});
