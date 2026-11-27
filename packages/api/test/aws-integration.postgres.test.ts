import { createHash, createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { OAuthProps } from "../src/types";
import { ApiService } from "../src/api-service";
import { protectedApiFetch } from "../src/protected-api";
import worker from "../src/worker";
import { loadingFixture } from "./helpers/loading-fixture";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

const url = process.env.AUTH_TEST_DATABASE_URL;
const arn = "arn:aws:iam::123456789012:role/factorize/fake";
const accessKey = "ASIA" + "A".repeat(16), secret = "z".repeat(40), sessionToken = "A".repeat(40) + "=";
const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const scope = "integrations:read";
const sig = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text).digest();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function checkSignature(request: Request, body: string) {
  const [_, date, names, signature] = /^AWS4-HMAC-SHA256 Credential=ASIA[A-Z0-9]{16}\/(\d{8})\/us-east-1\/aws-mcp\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([\da-f]{64})$/.exec(request.headers.get("authorization")!)!;
  const canonical = names.split(";").map(name => name + ":" + (name === "host" ? new URL(request.url).host : request.headers.get(name)?.trim()) + "\n").join("");
  const digest = hash([request.method, "/mcp", "", canonical, names, hash(body)].join("\n"));
  const signingKey = sig(sig(sig(sig("AWS4" + secret, date), "us-east-1"), "aws-mcp"), "aws4_request");
  expect(signature).toBe(createHmac("sha256", signingKey).update(["AWS4-HMAC-SHA256", request.headers.get("x-amz-date"), date + "/us-east-1/aws-mcp/aws4_request", digest].join("\n")).digest("hex"));
  expect(request.headers.get("x-amz-security-token")).toBe(sessionToken);
}

it.skipIf(!url)("verifies exact OIDC trust and scoped SigV4 over Worker REST and MCP, including denied, isolated and revoked access", async () => {
  const f = await loadingFixture(url!);
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]) }, true, ["sign","verify"]);
  const key = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const api = (suffix = "", method = "GET", input?: object, cookie = f.cookie) => worker.fetch(new Request(f.env.APP_ORIGIN + "/api/v1/integrations/aws" + suffix, {
    method, headers: { Cookie: cookie, Origin: f.env.APP_ORIGIN, "Content-Type": "application/json" }, body: input ? JSON.stringify(input) : undefined,
  }), f.env, ctx);
  let connectionId = "", issuer = "", calls = 0, exchanges = 0, rejectTrust = false, loseGrant = false, closed = 0;
  const install = crypto.randomUUID(), otherInstall = crypto.randomUUID(), grant = crypto.randomUUID(), otherGrant = crypto.randomUUID();
  try {
    expect(await (await api()).json()).toEqual({ available: false, connections: [] });
    f.env.AWS_WORKLOAD_SIGNING_KEYS = JSON.stringify({ active: { ...key, kid: "aws-test" } });
    expect((await api("", "POST", { name: "Dev", region: "us-east-1" }, "broken")).status).toBe(401);
    expect((await api("", "POST", { name: "Dev", region: "us-east-1", roleArn: arn })).status).toBe(400);
    const setup = await api("", "POST", { name: "Dev", region: "us-east-1" });
    expect(setup.status).toBe(201);
    const pending = await setup.json() as any;
    connectionId = pending.connection.id;
    expect(pending.connection).toMatchObject({ name: "Dev", roleArn: null, oauthInstallationId: null });
    const trust = JSON.parse(pending.template).Resources.FactorizeRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
    issuer = f.env.APP_ORIGIN + "/oauth/aws";
    expect(trust).toEqual({ "factorize.test/oauth/aws:aud": "sts.amazonaws.com", "factorize.test/oauth/aws:sub": "factorize-aws:" + connectionId });
    const discovery = await (await worker.fetch(new Request(issuer + "/.well-known/openid-configuration"), f.env, ctx)).json() as any;
    expect(discovery).toMatchObject({ issuer, jwks_uri: issuer + "/jwks", claims_supported: ["iss","aud","sub","iat","exp"] });
    const jwks = await (await worker.fetch(new Request(discovery.jwks_uri), f.env, ctx)).json() as any;
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(["alg","e","kid","kty","n","use"]);
    expect((await worker.fetch(new Request(issuer + "/token", { method: "POST" }), f.env, ctx)).status).toBe(404);
    expect((await worker.fetch(new Request("https://other.test/oauth/aws/jwks"), f.env, ctx)).status).toBe(404);

    const verifier = await crypto.subtle.importKey("jwk", jwks.keys[0], { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    vi.stubGlobal("fetch", async (value: string | Request, init?: RequestInit) => {
      const request = value instanceof Request ? value : new Request(value, init);
      expect(request.redirect).toBe("error");
      if (request.url === "https://sts.us-east-1.amazonaws.com/") {
        exchanges++;
        const data = new URLSearchParams(await request.text());
        expect(data.get("RoleArn")).toBe(arn);
        expect(data.get("Action")).toBe("AssumeRoleWithWebIdentity");
        expect(data.get("DurationSeconds")).toBe("900");
        expect(JSON.parse(data.get("Policy")!).Statement[0]).toMatchObject({
          Action: ["lambda:ListFunctions","ec2:DescribeInstances","cloudfront:ListDistributions"],
          Condition: { StringEquals: { "aws:CalledViaAWSMCP": "aws-mcp.amazonaws.com" } },
        });
        const [header, claims, signature] = data.get("WebIdentityToken")!.split(".");
        expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", verifier, Buffer.from(signature, "base64url"), Buffer.from(header + "." + claims))).toBe(true);
        const token = JSON.parse(Buffer.from(claims, "base64url").toString());
        expect(token).toMatchObject({ iss: issuer, aud: trust["factorize.test/oauth/aws:aud"], sub: trust["factorize.test/oauth/aws:sub"] });
        expect(token.exp - token.iat).toBe(120);
        if (rejectTrust) return new Response("fixture: confidential upstream trust error", { status: 403 });
        if (loseGrant) await f.db.pool.query("UPDATE app.oauth_installations SET revoked_at=now() WHERE tenant_id=$1 AND id=$2", [f.tenantId,install]);
        return new Response(`<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>${accessKey}</AccessKeyId><SecretAccessKey>${secret}</SecretAccessKey><SessionToken>${sessionToken}</SessionToken><Expiration>${new Date(Date.now()+900_000).toISOString()}</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`);
      }
      expect(request.url).toBe("https://aws-mcp.us-east-1.api.aws/mcp");
      const body = await request.text();
      checkSignature(request, body);
      if (request.method === "DELETE") { closed++; expect(request.headers.get("mcp-session-id")).toBe("upstream-123"); return new Response(null, {status: 204}); }
      const rpc = JSON.parse(body);
      if (rpc.method === "initialize") return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25" } }, { headers: { "Mcp-Session-Id": "upstream-123" } });
      expect(request.headers.get("mcp-session-id")).toBe("upstream-123");
      expect(request.headers.get("mcp-protocol-version")).toBe("2025-11-25");
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      calls++;
      expect(rpc.method).toBe("tools/call");
      expect(rpc.params.name).toBe("aws___run_script");
      const code = rpc.params.arguments.code;
      expect(Object.keys(rpc.params.arguments)).toEqual(["code"]);
      if (code.includes("ListDistributions")) return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ status: "error", stderr: "AccessDenied: secret details" }) }] } });
      const payload = code.includes("DescribeInstances") ? { Reservations: [{ Instances: [{ InstanceId: "i-fixed", PrivateIpAddress: "redacted" }] }], NextToken: "not-returned" } :
        { Functions: [{ FunctionName: "hello-world", Environment: { Variables: { PRIVATE: "redacted" } } }] };
      const message = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ status: "success", return_value: payload }) }] } });
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode(": comment\r\n\r\ndata: " + message.slice(0, 30)));
        controller.enqueue(encoder.encode(message.slice(30) + "\r\n\r\n"));
        // Deliberately stays open. Factorize cancels after reading the matching reply.
      } }), { headers: { "Content-Type": "text/event-stream" } });
    });

    rejectTrust = true;
    const noTrust = await api("/" + connectionId + "/verify", "POST", { roleArn: arn });
    expect(noTrust.status).toBe(403);
    expect(await noTrust.text()).not.toContain("confidential");
    expect((await (await api()).json() as any).connections[0].roleArn).toBeNull();
    rejectTrust = false;
    const verified = await api("/" + connectionId + "/verify", "POST", { roleArn: arn });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ connection: { roleArn: arn, oauthInstallationId: null }, inventory: { identifiers: ["hello-world"], truncated: false } });

    for (const [installation, providerGrant] of [[install, grant], [otherInstall, otherGrant]]) {
      await f.db.pool.query(`INSERT INTO app.oauth_installations
        (tenant_id,user_id,id,client_id,redirect_uri,active_grant_id,active_session_version,selected_scopes,active_scopes)
        VALUES($1,$2,$3,'same-client','https://example.test',$4,$5,ARRAY[$6]::text[],ARRAY[$6]::text[])`,
        [f.tenantId,f.userId,installation,providerGrant,f.auth.sessionVersion,scope]);
    }
    const agent = (installation = install, providerGrant = grant): OAuthProps => ({
      ...f.auth, scopes: [scope], authMethod: "oauth", oauthInstallationId: installation, oauthGrantId: providerGrant, oauthClientId: "same-client", oauthExpiresAt: Date.now()/1000+60,
    });
    const mcp = async (auth: OAuthProps, service: string, extra = {}) => {
      const request = new Request(f.env.APP_ORIGIN + "/mcp", { method: "POST", headers: {
        Host: new URL(f.env.APP_ORIGIN).host, "Mcp-Protocol-Version": "2025-11-25", "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      }, body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "list_aws_inventory", arguments: { connectionId, service, ...extra } } }) });
      return (await protectedApiFetch(request, f.env, auth, ctx)).text();
    };
    expect(await mcp(agent(), "lambda")).toContain("AWS connection not found");
    const access = await api("/" + connectionId + "/access", "PUT", { oauthInstallationId: install });
    expect(access.status).toBe(200);
    const inventory = await mcp(agent(), "ec2");
    expect(inventory).toContain("i-fixed");
    expect(inventory).not.toMatch(/redacted|not-returned|SessionToken/);
    expect(await mcp(agent(), "cloudfront")).toContain("aws_permission_denied");
    expect(await mcp(agent(), "lambda", { code: "not accepted" })).not.toContain("hello-world");
    expect(await mcp(agent(otherInstall, otherGrant), "lambda")).toContain("AWS connection not found");
    expect(await mcp({ ...f.auth, authMethod: "access_token" }, "lambda")).toContain("explicitly authorized");
    expect(calls).toBe(3);
    expect(closed).toBe(3);
    loseGrant = true;
    expect(await mcp(agent(), "lambda")).toContain("AWS connection not found");
    expect(exchanges).toBe(5);
    expect(calls).toBe(3);
    const removed = await api("/" + connectionId, "DELETE");
    expect(removed.status).toBe(200);
    expect((await (await api()).json() as any).connections).toEqual([]);
  } finally { vi.unstubAllGlobals(); await f.cleanup(); }
});
