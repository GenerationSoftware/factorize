import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createFlyMachinesClient, FlyClientError, type FlyMachine } from "../src/fly-machines-client.js";

const token = "test-fly-secret-do-not-leak";
const servers: Server[] = [];

async function fakeFly(handler: (request: any, response: any) => void | Promise<void>) {
  const server = createServer((request, response) => { void handler(request, response); });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Fly server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

function json(response: any, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
  }));
});

describe("bounded Fly Machines client", () => {
  it("creates, inspects, starts, stops, updates config, and destroys with documented paths", async () => {
    const calls: Array<{ method: string; path: string; auth: string | undefined }> = [];
    const machine: FlyMachine = { id: "m-1", state: "created" };
    const origin = await fakeFly(async (req, res) => {
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization });
      if (req.method === "GET" && req.url === "/v1/apps/app-a/machines") return json(res, 200, []);
      if (req.method === "POST" && req.url === "/v1/apps/app-a/machines") {
        let raw = ""; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        expect(body.config.metadata.factorize_operation_id).toBe("op-1");
        return json(res, 200, machine);
      }
      if (req.method === "GET" && req.url === "/v1/apps/app-a/machines/m-1") return json(res, 200, machine);
      if (req.method === "POST" && ["/v1/apps/app-a/machines/m-1/start", "/v1/apps/app-a/machines/m-1/stop"].includes(req.url)) {
        res.writeHead(204); return res.end();
      }
      if (req.method === "POST" && req.url === "/v1/apps/app-a/machines/m-1") return json(res, 200, machine);
      if (req.method === "DELETE" && req.url === "/v1/apps/app-a/machines/m-1") { res.writeHead(204); return res.end(); }
      json(res, 404, { error: "not found" });
    });
    const client = createFlyMachinesClient({ token, apiOrigin: origin, wait: async () => undefined });
    const created = await client.createMachine("app-a", { image: "example/image", metadata: { keep: "yes" } }, "op-1");
    expect(created.id).toBe("m-1");
    expect((await client.inspectMachine("app-a", "m-1")).id).toBe("m-1");
    await client.startMachine("app-a", "m-1");
    await client.stopMachine("app-a", "m-1");
    expect((await client.updateMachineConfig("app-a", "m-1", { image: "example/new" })).id).toBe("m-1");
    await client.destroyMachine("app-a", "m-1");
    expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/apps/app-a/machines", "POST /v1/apps/app-a/machines", "GET /v1/apps/app-a/machines/m-1",
      "POST /v1/apps/app-a/machines/m-1/start", "POST /v1/apps/app-a/machines/m-1/stop",
      "POST /v1/apps/app-a/machines/m-1", "DELETE /v1/apps/app-a/machines/m-1",
    ]);
  });

  it("returns typed auth errors without exposing credentials or provider bodies", async () => {
    const origin = await fakeFly((_req, res) => json(res, 401, { detail: token }));
    const client = createFlyMachinesClient({ token, apiOrigin: origin });
    await expect(client.inspectMachine("app", "machine")).rejects.toMatchObject({ kind: "auth", status: 401 });
    try { await client.inspectMachine("app", "machine"); } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain("detail");
    }
  });

  it("bounds a stalled response body and reports a secret-safe timeout", async () => {
    let count = 0;
    let markRequestReceived!: () => void;
    const requestReceived = new Promise<void>(resolve => { markRequestReceived = resolve; });
    const origin = await fakeFly((_req, res) => {
      count++;
      markRequestReceived();
      res.writeHead(200, { "content-type": "application/json" });
      res.flushHeaders();
      // Deliberately leave the body open until the client deadline aborts it.
    });
    const client = createFlyMachinesClient({ token, apiOrigin: origin, timeoutMs: 1_000, maxRetries: 0 });
    const inspection = client.inspectMachine("app", "machine");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([requestReceived, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Fake Fly server did not receive the bounded request")), 5_000); })]);
    } finally { if (deadline) clearTimeout(deadline); }
    await expect(inspection).rejects.toMatchObject({ kind: "timeout" });
    expect(count).toBe(1);
  });

  it("retries a safe read only within the configured request bound for 429 and 5xx", async () => {
    for (const status of [429, 503]) {
      let count = 0;
      const origin = await fakeFly((_req, res) => {
        count++;
        if (count < 3) return json(res, status, { secret: token });
        json(res, 200, { id: "m-1" });
      });
      const client = createFlyMachinesClient({ token, apiOrigin: origin, maxRetries: 2, wait: async () => undefined });
      expect((await client.inspectMachine("app", "m-1")).id).toBe("m-1");
      expect(count).toBe(3);
    }
  });

  it("times out a stalled response and reconciles an ambiguous create by operation id", async () => {
    const machines: FlyMachine[] = [];
    let createCount = 0;
    let markCreateReceived!: () => void;
    const createReceived = new Promise<void>(resolve => { markCreateReceived = resolve; });
    const origin = await fakeFly(async (req, res) => {
      if (req.method === "GET") return json(res, 200, machines);
      if (req.method === "POST") {
        createCount++;
        markCreateReceived();
        let raw = ""; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        const machine = { id: "m-created", config: body.config };
        machines.push(machine);
        // Commit the resource but leave the response stalled past the client's deadline.
        res.writeHead(200, { "content-type": "application/json" });
      }
    });
    const client = createFlyMachinesClient({ token, apiOrigin: origin, timeoutMs: 1_000, maxRetries: 0 });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let created: FlyMachine;
    try {
      const creation = client.createMachine("app", { image: "image" }, "op-ambiguous");
      await Promise.race([createReceived, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Fake Fly server did not receive the ambiguous create")), 5_000);
      })]);
      created = await creation;
    } finally { if (deadline) clearTimeout(deadline); }
    expect(created.id).toBe("m-created");
    expect(createCount).toBe(1);
  });

  it("reconciles a duplicate invocation before POST and never creates a second Machine", async () => {
    const machines: FlyMachine[] = [];
    let createCount = 0;
    const origin = await fakeFly(async (req, res) => {
      if (req.method === "GET") return json(res, 200, machines);
      createCount++;
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const machine = { id: `m-${createCount}`, config: body.config };
      machines.push(machine);
      json(res, 200, machine);
    });
    const client = createFlyMachinesClient({ token, apiOrigin: origin });
    expect((await client.createMachine("app", { image: "image" }, "stable-op")).id).toBe("m-1");
    expect((await client.createMachine("app", { image: "image" }, "stable-op")).id).toBe("m-1");
    expect(createCount).toBe(1);
  });

  it("reconciles a provider duplicate response using the stable operation id", async () => {
    let machine: FlyMachine | undefined;
    let gets = 0;
    let posts = 0;
    const origin = await fakeFly(async (req, res) => {
      if (req.method === "GET") {
        gets++;
        return json(res, 200, machine ? [machine] : []);
      }
      posts++;
      let raw = ""; for await (const chunk of req) raw += chunk;
      machine = { id: "created-by-concurrent-request", config: JSON.parse(raw).config };
      return json(res, 409, { detail: "duplicate create" });
    });
    const client = createFlyMachinesClient({ token, apiOrigin: origin });
    expect((await client.createMachine("app", { image: "image" }, "concurrent-op")).id).toBe("created-by-concurrent-request");
    expect(gets).toBe(2);
    expect(posts).toBe(1);
  });

  it("does not retry create after an ambiguous outcome that cannot be reconciled", async () => {
    let count = 0;
    const origin = await fakeFly((req, res) => {
      if (req.method === "GET") return json(res, 200, []);
      count++;
      res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ detail: token }));
    });
    const client = createFlyMachinesClient({ token, apiOrigin: origin, wait: async () => undefined });
    await expect(client.createMachine("app", { image: "image" }, "op-fail")).rejects.toMatchObject({ kind: "ambiguous_create" });
    expect(count).toBe(1);
  });
});
