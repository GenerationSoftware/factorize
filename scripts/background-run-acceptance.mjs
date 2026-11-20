import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { watchRun } from "./watch-run.mjs";

// Runs inside the local workerd + Postgres integration lane. The originating
// conversation is an idle host inbox. Only the external VM provider is replaced.
export async function backgroundRunAcceptance({
  db,
  tenant,
  encrypt,
  json,
  owner,
  rpc,
  authorize,
  worker,
  origin,
  maintenance,
  foreignToken,
  readOnly,
}) {
  const projectId = randomUUID(),
    connectionId = randomUUID();
  await db.query("INSERT INTO app.projects(tenant_id,id,name) VALUES($1,$2,'Background runs')", [
    tenant,
    projectId,
  ]);
  await db.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)", [
    tenant,
    "exe:" + connectionId,
    encrypt(JSON.stringify({ agentKind: "codex", connectionId })),
  ]);
  const defaults = await json(
    "/api/v1/projects/" + projectId + "/run-defaults",
    "PUT",
    { executionConfigId: connectionId, capacity: 2 },
    owner,
  );
  assert.equal(defaults.status, 200, JSON.stringify(defaults.body));
  const skill = await json("/api/v1/skills", "POST", { key: "dev", body: "Development instructions" }, owner);
  assert.ok(skill.body.id, JSON.stringify(skill));
  const token = await authorize(["runs:start", "runs:read", "runs:cancel"]);
  const args = { projectId, skill: "dev", prompt: "Review {{literal}}", idempotencyKey: "once" };
  assert.match((await rpc(readOnly, "start_run", args)).text, /insufficient_scope/);
  assert.match((await rpc(foreignToken, "start_run", args)).text, /not_found/);
  const starts = await Promise.all([rpc(token, "start_run", args), rpc(token, "start_run", args)]);
  assert.ok(starts[0].result?.runId, starts[0].text);
  const receipt = starts[0].result;
  assert.equal(receipt.runId, starts[1].result.runId);
  assert.deepEqual(starts.map((r) => r.result.duplicate).sort(), [false, true]);
  assert.match((await rpc(token, "start_run", { ...args, prompt: "changed" })).text, /idempotency_conflict/);
  const detail = (await rpc(token, "get_run", { runId: receipt.runId })).result;
  assert.equal(detail.job_id, null);
  assert.equal(detail.prompt, "Development instructions\n\nReview {{literal}}");
  assert.equal(detail.launch_skill_revision, 1);
  assert.deepEqual(
    (await rpc(token, "list_runs", { launchSkillId: skill.body.id })).result.items.map((r) => r.id),
    [receipt.runId],
  );

  // Model an external host's durable conversation inbox, including idempotent
  // insertion when a new session resumes a subscription after delivery.
  await db.query("CREATE TEMP TABLE host_inbox(conversation text,event_id uuid PRIMARY KEY,message jsonb)");
  const messages = async () =>
    new Map(
      (await db.query("SELECT event_id,message FROM host_inbox")).rows.map((row) => [
        row.event_id,
        row.message,
      ]),
    );
  let liveFrames;
  function watch(uri, onPending, credential = token) {
    return watchRun({
      outcomeUri: uri,
      conversationId: "parent-session",
      signal: AbortSignal.timeout(20_000),
      request: async (body, headers, signal) => {
        const response = await worker.fetch(origin + "/mcp", {
          method: "POST",
          headers: { ...headers, Authorization: "Bearer " + credential.access_token },
          body: JSON.stringify(body),
          signal,
        });
        if (body.method === "subscriptions/listen" && onPending && response.ok)
          liveFrames = response.clone().text();
        if (body.method === "resources/read" && onPending && response.ok) {
          const message = await response.clone().json();
          if (!JSON.parse(message.result.contents[0].text).eventId) onPending();
        }
        return response;
      },
      deliver: async (message) => {
        await db.query("INSERT INTO host_inbox VALUES ($1,$2,$3) ON CONFLICT(event_id) DO NOTHING", [
          message.conversationId,
          message.eventId,
          message,
        ]);
      },
    });
  }
  assert.match((await rpc(foreignToken, "get_run", { runId: receipt.runId })).text, /not_found/);
  await assert.rejects(watch(receipt.outcomeUri, undefined, foreignToken), /404/);
  const ready = Promise.withResolvers();
  const delivery = watch(receipt.outcomeUri, ready.resolve);
  await Promise.race([ready.promise, delivery.then(() => assert.fail("run should be pending"))]);
  const raw = (await rpc(token, "start_run", { projectId, prompt: "Simulate a launch failure" })).result;
  assert.ok(raw.runId);
  // Two reserved slots and two waiting slots share the project limit.
  const queued = [];
  for (const prompt of ["First waiting run", "Second waiting run"]) {
    const waiting = (await rpc(token, "start_run", { projectId, prompt })).result;
    assert.equal((await rpc(token, "get_run", { runId: waiting.runId })).result.state, "queued");
    queued.push(waiting.runId);
  }
  assert.match((await rpc(token, "start_run", { projectId, prompt: "Over capacity" })).text, /queue_full/);
  assert.equal((await rpc(token, "start_run", args)).result.runId, receipt.runId);
  for (const runId of queued) await rpc(token, "stop_run", { runId });
  const tick = async () => {
    // Advance only the poll deadlines. All actual transitions go through RunScheduler.
    await db.query(
      "UPDATE app.job_runs SET next_poll_at=now() WHERE tenant_id=$1 AND id=$2 AND state='running'",
      [tenant, receipt.runId],
    );
    const response = await maintenance.fetch("https://maintenance/run-tick");
    assert.equal(response.status, 200);
    return response.json();
  };
  const launches = await tick();
  assert.equal(launches.filter((id) => id === receipt.runId).length, 1);
  for (let i = 0; i < 3; i++) await tick();
  await delivery;
  assert.match(await liveFrames, /notifications\/resources\/updated/);
  assert.equal((await messages()).get(receipt.runId)?.conversationId, "parent-session");
  assert.equal((await messages()).get(receipt.runId)?.result.summary, "Review complete");
  // The host went offline before failure. A new listen and read must recover it.
  await watch(raw.outcomeUri);
  assert.equal((await messages()).get(raw.runId)?.state, "failed");
  assert.equal((await messages()).get(raw.runId)?.failure.source, "system");
  const stopped = (await rpc(token, "start_run", { projectId, prompt: "Stop before launch" })).result;
  await rpc(token, "stop_run", { runId: stopped.runId });
  await watch(stopped.outcomeUri);
  assert.equal((await messages()).get(stopped.runId)?.state, "stopped");
  await watch(receipt.outcomeUri);
  assert.equal((await messages()).size, 3);
  const template = await json(
    "/api/v1/jobs",
    "POST",
    {
      name: "Review",
      slug: "review",
      projectId,
      executionConfigId: connectionId,
      launchSkillId: skill.body.id,
      skillIds: [skill.body.id],
      promptTemplate: "Check {{trigger-1.prompt}}",
    },
    owner,
  );
  assert.ok(template.body.id, JSON.stringify(template.body));
  const invocation = await json(
    "/api/v1/jobs/" + template.body.id + "/invocations",
    "POST",
    { prompt: "documentation" },
    owner,
  );
  assert.ok(invocation.body.runId, JSON.stringify(invocation.body));
  const savedRun = (await rpc(token, "get_run", { runId: invocation.body.runId })).result;
  assert.equal(savedRun.launch_skill_id, skill.body.id);
  assert.equal(savedRun.prompt, "Development instructions\n\nCheck documentation");
  const renamed = await json(
    "/api/v1/skills/" + skill.body.id,
    "PUT",
    { key: "reviewer", body: "Updated instructions", expectedRevision: 1 },
    owner,
  );
  assert.equal(renamed.status, 200);
  assert.equal((await json("/api/v1/jobs/" + template.body.id, "DELETE", undefined, owner)).status, 200);
  const retained = (await rpc(token, "get_run", { runId: savedRun.id })).result;
  assert.equal(retained.invocation.template_job_id, template.body.id);
  assert.equal(retained.launch_skill_key, "dev");
  assert.equal(retained.prompt, savedRun.prompt);
  const ambiguous = await rpc(token, "start_run", { ...args, script: "echo ambiguous" });
  assert.ok(!ambiguous.result?.runId, ambiguous.text);
  const directScript = await rpc(token, "start_run", { projectId, script: "echo direct", integrationIds: [], runScopes: [] });
  assert.ok(directScript.result?.runId, directScript.text);
  const snapshot = (await db.query("SELECT job_id, execution_config FROM app.runs WHERE tenant_id=$1 AND id=$2", [tenant, directScript.result.runId])).rows[0];
  assert.equal(snapshot.job_id, null);
  assert.equal(snapshot.execution_config.script, "echo direct");
  assert.equal(snapshot.execution_config.executionType, "code");
  await rpc(token, "stop_run", { runId: directScript.result.runId });
}
