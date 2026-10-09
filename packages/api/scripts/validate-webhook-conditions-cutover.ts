import pg from "pg";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateWebhookConditions } from "../src/webhook-conditions";
// @ts-expect-error Standalone deployment helper has no declaration file.
import { restoreConditionsCutover } from "./webhook-conditions-cutover.mjs";
const connection = new URL(process.env.DATABASE_URL!);
if (process.argv.includes("--neon")) {
  // This exact isolated endpoint was created via the documented Neon API.
  // Reuse the CI-held role credential without retrieving or printing it.
  connection.hostname = "ep-patient-voice-arpjw9pa.c-4.us-west-2.aws.neon.tech";
} else assert.ok(["localhost", "127.0.0.1"].includes(connection.hostname));
const client = new pg.Client({ connectionString: connection.href, ssl: connection.hostname.endsWith(".neon.tech") ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  const sql = await readFile(new URL("../migrations/0013_webhook_conditions.sql", import.meta.url), "utf8");
  const conditions = JSON.parse(await readFile(new URL("../migrations/build-manager-conditions.json", import.meta.url), "utf8"));
  const before = (await client.query("SELECT tenant_id,id,job_id,slug,kind,enabled,config,removed_at FROM app.triggers ORDER BY tenant_id,id")).rows;
  const handlers = before.filter(row => Object.hasOwn(row.config, "handlerCode"));
  console.log(JSON.stringify({ storedTriggers: before.length, handlers: handlers.map(row => ({ jobId: row.job_id, triggerId: row.id, slug: row.slug, enabled: row.enabled, removed: Boolean(row.removed_at) })) }));
  assert.equal(handlers.length, 1, "Validation expects the re-inventoried live handler; review changed inventory");
  const original = handlers[0];
  // Unexpected handler blockers must roll back the entire migration.
  await client.query("BEGIN");
  await client.query("UPDATE app.triggers SET config=jsonb_set(config,'{handlerCode}',to_jsonb('unreviewed'::text)) WHERE tenant_id=$1 AND id=$2", [original.tenant_id, original.id]);
  await assert.rejects(client.query(sql), /migration blocker/);
  await client.query("ROLLBACK");
  await client.query("BEGIN"); await client.query(sql); await client.query("COMMIT");
  const converted = (await client.query("SELECT * FROM app.triggers WHERE tenant_id=$1 AND id=$2", [original.tenant_id, original.id])).rows[0];
  assert.equal(converted.enabled, false); assert.deepEqual(converted.config, { ...Object.fromEntries(Object.entries(original.config).filter(([key]) => key !== "handlerCode")), conditions });
  for (const [conclusion, branch, sender, app, expected] of [["success", "gh-readonly-queue/main/a", "human", "actions", "no-match"], ["success", "main", "github-merge-queue[bot]", "actions", "no-match"], ["skipped", "feature", "human", "mintlify", "no-match"], ["failure", "feature", "human", "actions", "match"]]) {
    assert.equal((await evaluateWebhookConditions(converted.config.conditions, { check_suite: { conclusion, head_branch: branch, app: { slug: app } }, sender: { login: sender } })).decision, expected);
  }
  assert.equal((await evaluateWebhookConditions(converted.config.conditions, {})).decision, "match");
  await assert.rejects(client.query("UPDATE app.triggers SET config=config || '{\"handlerCode\":\"removed\"}'::jsonb WHERE tenant_id=$1 AND id=$2", [original.tenant_id, original.id]), /no_webhook_handler_code/);
  await restoreConditionsCutover(client);
  const after = (await client.query("SELECT tenant_id,id,job_id,slug,kind,enabled,config,removed_at FROM app.triggers ORDER BY tenant_id,id")).rows;
  const expected = before.map(row => row.id === original.id && row.tenant_id === original.tenant_id ? { ...row, config: converted.config } : row);
  assert.deepEqual(after, expected);
  assert.equal((await client.query("SELECT count(*)::int n FROM app.triggers WHERE config ? 'handlerCode'")).rows[0].n, 0);
  console.log("Isolated cutover validation passed: conversion, blocker rollback, strict rejection, restoration, unchanged identity/routing/context.");
} finally { await client.end(); }
