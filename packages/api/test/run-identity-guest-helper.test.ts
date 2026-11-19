import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_IDENTITY_GUEST_HELPER } from "../src/run-identity-guest-helper";
import type { Server } from "node:http";

const runId = "11111111-1111-4111-8111-111111111111";
const config = {runId, backendOrigin: "https://factorize.example.com", provider: "exe.dev", integrationName: "fz-run-test"};
let helper: any;
beforeAll(async () => { helper = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(RUN_IDENTITY_GUEST_HELPER).toString("base64")}`); });
const servers: Server[] = [];
afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(resolve => {server.closeAllConnections(); server.close(() => resolve());}))); });
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as {port: number}).port}`;
}

describe("run-owned vendor identity guest helper", () => {
  it("renews vendor identity per request and streams only to the configured backend", async () => {
    let tokens = 0;
    const forwarded: Array<{url: string; token: string; body: string; protocol: string | null}> = [];
    const server = helper.createRunIdentityProxy(config, {
      getToken: async () => `header.claims.signature${++tokens}`,
      fetcher: async (input: string, init: RequestInit) => {
        const headers = init.headers as Headers;
        expect(headers.get("X-Factorize-Run-Id")).toBe(runId);
        expect(headers.has("Cookie")).toBe(false);
        forwarded.push({url: input, token: headers.get("Authorization")!, body: await new Response(init.body).text(), protocol: headers.get("Git-Protocol")});
        return new Response("data: streamed\n\n", {headers: {"Content-Type": "text/event-stream", "Set-Cookie": "private=value"}});
      },
    });
    const origin = await listen(server);
    const response = await fetch(`${origin}/providers/github/17/owner/repo.git/git-upload-pack`, {method: "POST", body: "pack-request", headers: {Authorization: "Bearer guest-supplied", Cookie: "factorize_session=private", "X-Factorize-Run-Id": "other-run", "Git-Protocol": "version=2"}});
    expect(await response.text()).toBe("data: streamed\n\n");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    const xId = "22222222-2222-4222-8222-222222222222";
    await (await fetch(`${origin}/x/${xId}/2/users/me?user.fields=id`, {headers: {Authorization: "Bearer guest-supplied"}})).body?.cancel();
    await (await fetch(`${origin}/api/v1/runtime-context`)).body?.cancel();
    await (await fetch(`${origin}/integrations`)).body?.cancel();
    expect(forwarded).toMatchObject([
      {url: `https://factorize.example.com/internal/run-proxy/${runId}/providers/github/17/owner/repo.git/git-upload-pack`, token: "Bearer header.claims.signature1", body: "pack-request", protocol: "version=2"},
      {url: `https://factorize.example.com/internal/run-proxy/${runId}/x/${xId}/2/users/me?user.fields=id`, token: "Bearer header.claims.signature2"},
      {url: "https://factorize.example.com/api/v1/runtime-context", token: "Bearer header.claims.signature3"},
      {url: "https://factorize.example.com/api/v1/runtime-integrations", token: "Bearer header.claims.signature4"},
    ]);
  });

  it("fails closed when vendor identity is unavailable and rejects unsupported providers", async () => {
    let calls = 0;
    const origin = await listen(helper.createRunIdentityProxy(config, {getToken: async () => {throw new Error("private provider response");}, fetcher: async () => {calls++; return new Response("unexpected");}}));
    const response = await fetch(`${origin}/api/v1/runtime-context`);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Factorize run access unavailable");
    expect(calls).toBe(0);
    expect(() => helper.createRunIdentityProxy({...config, provider: "shared-secret", token: "fallback"})).toThrow("Unsupported");
    expect(() => helper.createRunIdentityProxy({...config, backendOrigin: "http://factorize.example.com"})).toThrow("origin");
  });

  it("acquires exe.dev tokens only from the documented exact integration host", async () => {
    const calls: string[] = [];
    const token = await helper.vendorToken(config, async (url: string, init: RequestInit) => {
      calls.push(url); expect(init.redirect).toBe("error");
      return Response.json({token: "header.claims.signature"});
    });
    expect(token).toBe("header.claims.signature");
    expect(calls).toEqual(["https://fz-run-test.int.exe.xyz/token"]);
    await expect(helper.vendorToken(config, async () => new Response("private", {status: 403}))).rejects.toThrow("Vendor identity unavailable");
  });
});
