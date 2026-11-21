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
  const connectionId = randomUUID(), modelId = randomUUID();
  await db.query("INSERT INTO app.integration_records(tenant_id,id,kind,name,revision,encrypted_payload) VALUES($1,$2,'model','Background model',1,$3)", [tenant,modelId,encrypt('factorize-managed-model-cache-v1:'+JSON.stringify({providerUrl:"https://api.openai.com/v1"}))]);
  await db.query("UPDATE app.agent_integrations SET policy='baseline' WHERE tenant_id=$1 AND credential_id=$2",[tenant,modelId]);
  await db.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)", [
    tenant,
    "exe:" + connectionId,
    encrypt(JSON.stringify({ connectionId })),
  ]);
  const defaults = await json(
    "/api/v1/team/run-defaults",
    "PUT",
    { requiresVm: false, modelAccountId: modelId, model: "fixture", capacity: 2 },
    owner,
  );
  assert.equal(defaults.status, 200, JSON.stringify(defaults.body));
  const skill = await json("/api/v1/skills", "POST", { key: "dev", body: "Development instructions" }, owner);
  assert.ok(skill.body.id, JSON.stringify(skill));
  const token = await authorize(["runs:start", "runs:read", "runs:cancel"]);
  const args = { skill: "dev", prompt: "Review {{literal}}", idempotencyKey: "once" };
  assert.match((await rpc(readOnly, "start_run", args)).text, /insufficient_scope/);
  assert.match((await rpc(foreignToken, "start_run", args)).text, /not_found/);
  const starts = await Promise.all([rpc(token, "start_run", args), rpc(token, "start_run", args)]);
  assert.ok(starts[0].result?.runId, starts[0].text);
  const receipt = starts[0].result;
  assert.equal(receipt.runId, starts[1].result.runId);
  assert.deepEqual(starts.map((r) => r.result.duplicate).sort(), [false, true]);
  assert.match((await rpc(token, "start_run", { ...args, prompt: "changed" })).text, /idempotency_conflict/);
  const detail = (await rpc(token, "get_run", { runId: receipt.runId })).result;
  assert.equal(detail.trigger_id, null);
  assert.equal(detail.prompt, "Development instructions\n\nReview {{literal}}");
  assert.equal(detail.launch_skill_revision, 1);
  assert.deepEqual(
    (await rpc(token, "list_runs", { skillId: skill.body.id })).result.items.map((r) => r.id),
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
  const raw = (await rpc(token, "start_run", { prompt: "Simulate a launch failure" })).result;
  assert.ok(raw.runId);
  // Two reserved slots and two waiting slots share the Team limit.
  const queued = [];
  for (const prompt of ["First waiting run", "Second waiting run"]) {
    const waiting = (await rpc(token, "start_run", { prompt })).result;
    assert.equal((await rpc(token, "get_run", { runId: waiting.runId })).result.state, "queued");
    queued.push(waiting.runId);
  }
  assert.match((await rpc(token, "start_run", { prompt: "Over capacity" })).text, /queue_full/);
  assert.equal((await rpc(token, "start_run", args)).result.runId, receipt.runId);
  for (const runId of queued) await rpc(token, "stop_run", { runId });
  const tick = async () => {
    // Advance only the poll deadlines. All actual transitions go through RunScheduler.
    await db.query(
      "UPDATE app.trigger_runs SET next_poll_at=now() WHERE tenant_id=$1 AND state='running'",
      [tenant],
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
  const completed=(await messages()).get(receipt.runId);
  assert.equal(completed?.state,"succeeded",JSON.stringify(completed));
  assert.equal(completed.result.summary, "Review complete");
  // The host went offline before failure. A new listen and read must recover it.
  await watch(raw.outcomeUri);
  assert.equal((await messages()).get(raw.runId)?.state, "failed");
  assert.equal((await messages()).get(raw.runId)?.failure.source, "system");
  const stopped = (await rpc(token, "start_run", { prompt: "Stop before launch" })).result;
  await rpc(token, "stop_run", { runId: stopped.runId });
  await watch(stopped.outcomeUri);
  assert.equal((await messages()).get(stopped.runId)?.state, "stopped");
  await watch(receipt.outcomeUri);
  assert.equal((await messages()).size, 3);
  const template = await json(
    "/api/v1/triggers",
    "POST",
    {
      name: "review",

      skillId: skill.body.id,
      prompt: "Check",
    },
    owner,
  );
  assert.ok(template.body.id, JSON.stringify(template.body));
  const invocation = await json(
    "/api/v1/triggers/" + template.body.id + "/invocations",
    "POST",
    { prompt: "documentation" },
    owner,
  );
  assert.ok(invocation.body.runId, JSON.stringify(invocation.body));
  const savedRun = (await rpc(token, "get_run", { runId: invocation.body.runId })).result;
  assert.equal(savedRun.launch_skill_id, skill.body.id);
  assert.equal(savedRun.prompt, "Development instructions\n\nCheck\n\ndocumentation");
  const renamed = await json(
    "/api/v1/skills/" + skill.body.id,
    "PUT",
    { key: "reviewer", body: "Updated instructions", expectedRevision: 1 },
    owner,
  );
  assert.equal(renamed.status, 200);
  assert.equal((await json("/api/v1/triggers/" + template.body.id, "DELETE", undefined, owner)).status, 200);
  const retained = (await rpc(token, "get_run", { runId: savedRun.id })).result;
  assert.equal(retained.invocation.template_trigger_id, template.body.id);
  assert.equal(retained.launch_skill_key, "dev");
  assert.equal(retained.prompt, savedRun.prompt);
  const ambiguous = await rpc(token, "start_run", { ...args, script: "echo ambiguous" });
  assert.ok(!ambiguous.result?.runId, ambiguous.text);
  const directScript = await rpc(token, "start_run", { script: "echo direct", requiresVm: true, executionConfigId: connectionId, integrationIds: [], runScopes: [] });
  assert.ok(!directScript.result?.runId,directScript.text);
  assert.match(directScript.text,/scripts_retired/);
}
