import { env, fetchMock, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../src/index";
import type { Env as FactorizeEnv } from "../src/types";

declare module "cloudflare:test" { interface ProvidedEnv extends FactorizeEnv {} }

const origin = "https://app.factorize.sh";

describe("exe.dev run lifecycle", () => {
  const vms = new Map<string, { comment: string; state?: "running" | "succeeded" | "failed" }>();
  let scenario: "success" | "launch-failure" = "success";
  let agentOutput = "Hello from the stubbed agent!";

  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get("https://exe.dev").intercept({ path: "/exec", method: "POST" }).reply(options => {
      const command = String(options.body ?? ""), headers = { "X-Exe-Exit": "0", "Content-Type": "text/plain" };
      if (command === "ls --json") return { statusCode: 200, data: JSON.stringify({ vms: [...vms].map(([name, vm]) => ({ name, comment: vm.comment, tags: ["factorize"] })) }), responseOptions: { headers } };
      if (command === "integrations list --json") return { statusCode: 200, data: JSON.stringify({ integrations: [{ tags: ["factorize"] }] }), responseOptions: { headers } };
      if (command.endsWith("--help")) return { statusCode: 200, data: "help", responseOptions: { headers } };
      if (command.startsWith("new ")) {
        const name = command.match(/--name='([^']+)'/)?.[1] ?? "";
        vms.set(name, { comment: `Factorize VM ${name}` });
        return { statusCode: 200, data: JSON.stringify({ name }), responseOptions: { headers } };
      }
      if (command.startsWith("rm ")) { vms.delete(command.match(/^rm '([^']+)'/)?.[1] ?? ""); return { statusCode: 200, data: "removed", responseOptions: { headers } }; }
      if (command.startsWith("ssh ") && command.includes("command -v codex")) return { statusCode: 200, data: '["gpt-test"]', responseOptions: { headers } };
      if (command.startsWith("ssh ") && command.includes("systemd-run")) {
        if (scenario === "launch-failure") return { statusCode: 200, data: "bash: syntax error", responseOptions: { headers: { "Content-Type": "text/plain" } } };
        const name = command.match(/^ssh '([^']+)'/)?.[1] ?? ""; const vm = vms.get(name); if (vm) vm.state = "succeeded";
        return { statusCode: 200, data: "started", responseOptions: { headers } };
      }
      if (command.startsWith("ssh ") && command.includes("systemctl show")) {
        const name = command.match(/^ssh '([^']+)'/)?.[1] ?? "", state = vms.get(name)?.state ?? "running";
        return { statusCode: 200, data: state, responseOptions: { headers } };
      }
      if (command.startsWith("ssh ") && command.includes("cat /tmp/factorize.log")) return { statusCode: 200, data: agentOutput, responseOptions: { headers } };
      return { statusCode: 422, data: `unexpected command: ${command}` };
    }).persist();
  });

  it("stores a completed large transcript as scrubbed plaintext and reaches cleanup end to end", async () => {
    scenario = "success";
    const secret = "sk-this-must-never-be-stored";
    agentOutput = `Hello from the stubbed agent!\nAuthorization: Bearer ${secret}\n${"large transcript line 🐝\n".repeat(12_000)}`;
    const tenantId = `exe-e2e-${crypto.randomUUID()}`, userId = "owner";
    const tenant = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`));
    await tenant.fetch("https://tenant/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, email: "owner@example.com" }) });
    const session = await signSession({ tenantId, userId, email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60, sessionVersion: 1 }, "e2e-session-secret");
    const headers = { cookie: `factorize_session=${session}`, "content-type": "application/json" };

    const connected = await SELF.fetch(`${origin}/api/connections/exe`, { method: "PUT", headers, body: JSON.stringify({ connectionId: "exe-test", apiToken: "exe1-test", agentKind: "codex", tags: ["factorize"] }) });
    expect(connected.status, await connected.clone().text()).toBe(200);

    const integrationDiagnostic = await SELF.fetch(`${origin}/api/v1/integrations/exe/exe-test/diagnostics`, { method: "POST", headers });
    expect(integrationDiagnostic.status, await integrationDiagnostic.clone().text()).toBe(200);
    await expect(integrationDiagnostic.json()).resolves.toMatchObject({ ok: true, connectionId: "exe-test", permissions: { ok: true }, agent: { ok: true, models: ["gpt-test"] } });

    const created = await SELF.fetch(`${origin}/api/v1/jobs`, { method: "POST", headers, body: JSON.stringify({ name: "Stubbed run", slug: "stubbed-run", promptTemplate: "{{trigger-1.prompt}}", concurrencyLimit: 1, executionTargetId: "exe-test", model: "gpt-test", effort: "low", triggers: [{ kind: "manual", slug: "trigger-1", config: {} }] }) });
    expect(created.status, await created.clone().text()).toBe(201);
    const job = await created.json<{ id: string }>();
    const invoked = await SELF.fetch(`${origin}/api/v1/jobs/${job.id}/invocations`, { method: "POST", headers, body: JSON.stringify({ prompt: "say hello" }) });
    expect(invoked.status, await invoked.clone().text()).toBe(202);
    const run = await invoked.json<{ runId: string }>();

    for (let attempt = 0; attempt < 4; attempt++) await runDurableObjectAlarm(tenant);

    const inspected = await SELF.fetch(`${origin}/api/v1/runs/${run.runId}`, { headers });
    expect(inspected.status, await inspected.clone().text()).toBe(200);
    const body = await inspected.json<{ id: string; state: string; result: string; session: string }>();
    expect(body).toMatchObject({ id: run.runId, state: "succeeded" });
    expect(body.result).toContain("Hello from the stubbed agent!");
    expect(body.result).toContain("[REDACTED]");
    expect(body.result).not.toContain(secret);
    expect(body.result.length).toBeGreaterThan(250_000);
    expect(body.session).toBe(body.result);
    const stored = await runInDurableObject(tenant, (_instance, state) => {
      const [row] = [...state.storage.sql.exec<{ result: string; session: string }>("SELECT result,session FROM runs WHERE id=?", run.runId)];
      return row;
    });
    expect(stored.result).toBe(body.result);
    expect(stored.session).toBe(body.session);
    expect(stored.result).toContain("[REDACTED]");
    expect(stored.result).not.toContain(secret);
    const diagnostics = await SELF.fetch(`${origin}/api/v1/runs/${run.runId}/diagnostics`, { headers });
    expect(diagnostics.status, await diagnostics.clone().text()).toBe(200);
    await expect(diagnostics.json()).resolves.toMatchObject({ runId: run.runId, state: "succeeded", checks: { launchAcknowledged: true, promptAccepted: true, outputCaptured: true, claimReleased: true, cleanupComplete: true } });
    expect(vms.size).toBe(0);
  });

  it("reports an HTTP-200 shell launch failure without calling an LLM", async () => {
    scenario = "launch-failure";
    agentOutput = "Hello from the stubbed agent!";
    const tenantId = `exe-failure-${crypto.randomUUID()}`, userId = "owner";
    const tenant = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`));
    await tenant.fetch("https://tenant/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, email: "owner@example.com" }) });
    const session = await signSession({ tenantId, userId, email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60, sessionVersion: 1 }, "e2e-session-secret");
    const headers = { cookie: `factorize_session=${session}`, "content-type": "application/json" };
    const connected = await SELF.fetch(`${origin}/api/connections/exe`, { method: "PUT", headers, body: JSON.stringify({ connectionId: "exe-test", apiToken: "exe1-test", agentKind: "codex", tags: ["factorize"] }) });
    expect(connected.status, await connected.clone().text()).toBe(200);
    const created = await SELF.fetch(`${origin}/api/v1/jobs`, { method: "POST", headers, body: JSON.stringify({ name: "Failed stub", slug: "failed-stub", promptTemplate: "{{trigger-1.prompt}}", concurrencyLimit: 1, executionTargetId: "exe-test", model: "gpt-test", effort: "low", triggers: [{ kind: "manual", slug: "trigger-1", config: {} }] }) });
    const job = await created.json<{ id: string }>();
    const invoked = await SELF.fetch(`${origin}/api/v1/jobs/${job.id}/invocations`, { method: "POST", headers, body: JSON.stringify({ prompt: "say hello" }) });
    const run = await invoked.json<{ runId: string }>();
    for (let attempt = 0; attempt < 3; attempt++) await runDurableObjectAlarm(tenant);
    const diagnostics = await SELF.fetch(`${origin}/api/v1/runs/${run.runId}/diagnostics`, { headers });
    await expect(diagnostics.json()).resolves.toMatchObject({ state: "failed", checks: { launchAcknowledged: false, promptAccepted: false, claimReleased: true, cleanupComplete: true }, activity: expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("bash: syntax error") })]) });
    expect(vms.size).toBe(0);
  });

  it("repairs lost alarms, recovers stale starts, and kills queued runs without holding capacity", async () => {
    scenario = "success";
    agentOutput = "Hello from the stubbed agent!";
    const tenantId = `durability-${crypto.randomUUID()}`, userId = "owner";
    const tenant = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`));
    await tenant.fetch("https://tenant/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, email: "owner@example.com" }) });
    const session = await signSession({ tenantId, userId, email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60, sessionVersion: 1 }, "e2e-session-secret");
    const headers = { cookie: `factorize_session=${session}`, "content-type": "application/json" };
    await SELF.fetch(`${origin}/api/connections/exe`, { method: "PUT", headers, body: JSON.stringify({ connectionId: "exe-test", apiToken: "exe1-test", agentKind: "codex", tags: ["factorize"] }) });
    const created = await SELF.fetch(`${origin}/api/v1/jobs`, { method: "POST", headers, body: JSON.stringify({ name: "Durable queue", slug: "durable-queue", promptTemplate: "{{trigger-1.prompt}}", concurrencyLimit: 1, executionTargetId: "exe-test", model: "gpt-test", effort: "low", triggers: [{ kind: "manual", slug: "trigger-1", config: {} }] }) });
    const job = await created.json<{ id: string }>();
    const firstResponse = await SELF.fetch(`${origin}/api/v1/jobs/${job.id}/invocations`, { method: "POST", headers, body: JSON.stringify({ prompt: "first" }) });
    const secondResponse = await SELF.fetch(`${origin}/api/v1/jobs/${job.id}/invocations`, { method: "POST", headers, body: JSON.stringify({ prompt: "second" }) });
    const first = await firstResponse.json<{ runId: string }>(), second = await secondResponse.json<{ runId: string }>();

    // Workerd may eagerly deliver zero-delay alarms during the request. Put
    // both persisted records back into the pre-alarm state for this recovery
    // scenario.
    await runInDurableObject(tenant, async (_instance, state) => {
      await state.storage.deleteAlarm();
      for (const runId of [first.runId, second.runId]) {
        state.storage.sql.exec("UPDATE runs SET state='queued',execution_handle=NULL,prompt_accepted=0,prompt_delivery_state='pending',updated_at=? WHERE id=?", new Date().toISOString(), runId);
        state.storage.sql.exec("UPDATE job_runs SET state='queued',started_at=NULL,updated_at=? WHERE id=?", new Date().toISOString(), runId);
      }
    });

    const killed = await SELF.fetch(`${origin}/api/v1/runs/${first.runId}/kill`, { method: "POST", headers });
    expect(killed.status, await killed.clone().text()).toBe(200);
    await expect(killed.json()).resolves.toMatchObject({ id: first.runId, state: "stopped", killed: true, cleanupPending: false });

    // Simulate a deployment losing the alarm and interrupting the remaining
    // run after dequeue but before the backend acknowledged its launch.
    const alarmAfterDelete = await runInDurableObject(tenant, async (_instance, state) => {
      await state.storage.deleteAlarm();
      const stale = new Date(Date.now() - 3 * 60_000).toISOString();
      state.storage.sql.exec("UPDATE runs SET state='starting',prompt_accepted=0,updated_at=? WHERE id=?", stale, second.runId);
      state.storage.sql.exec("UPDATE job_runs SET state='running',started_at=?,updated_at=? WHERE id=?", stale, stale, second.runId);
      return state.storage.getAlarm();
    });
    expect(alarmAfterDelete).toBeNull();

    const inspected = await SELF.fetch(`${origin}/api/v1/runs/${second.runId}`, { headers });
    expect(inspected.status, await inspected.clone().text()).toBe(200);
    expect(await runInDurableObject(tenant, (_instance, state) => state.storage.getAlarm())).not.toBeNull();
    for (let attempt = 0; attempt < 4; attempt++) await runDurableObjectAlarm(tenant);

    const recovered = await SELF.fetch(`${origin}/api/v1/runs/${second.runId}`, { headers });
    await expect(recovered.json()).resolves.toMatchObject({ id: second.runId, state: "succeeded", result: expect.stringContaining("Hello from the stubbed agent!"), activity: expect.arrayContaining([expect.objectContaining({ action: "launch_lease_recovered" })]) });
  });
});
