import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
test("actual shared evaluator runs in workerd without Node compatibility or a worker loader", async () => {
  const result = await build({ stdin: { contents: `import { evaluateWebhookConditions } from './packages/api/src/webhook-conditions.ts'; export default { async fetch(request) { const { conditions, webhook } = await request.json(); return Response.json(await evaluateWebhookConditions(conditions, webhook)); } };`, resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "esm", write: false });
  const worker = new Miniflare({ workers: [{ config: { name: "conditions", type: "worker", manifest: { mainModule: "conditions.js", modules: { "conditions.js": { type: "esm", contents: result.outputFiles[0].text } } }, compatibilityDate: "2026-09-10", compatibilityFlags: ["global_fetch_strictly_public"] } }] });
  try {
    const conditions = JSON.parse(await readFile(new URL("../packages/api/migrations/build-manager-conditions.json", import.meta.url), "utf8"));
    for (const [conclusion, branch, sender, app, expected] of [["success", "gh-readonly-queue/main/a", "human", "actions", "no-match"], ["success", "main", "github-merge-queue[bot]", "actions", "no-match"], ["skipped", "feature", "human", "mintlify", "no-match"], ["failure", "main", "human", "actions", "match"]]) {
      const response = await worker.dispatchFetch("https://conditions.test", { method: "POST", body: JSON.stringify({ conditions, webhook: { check_suite: { conclusion, head_branch: branch, app: { slug: app } }, sender: { login: sender } } }) });
      const body = await response.json(); assert.equal(body.decision, expected); assert.equal(typeof body.details[0].conditions, "object");
    }
    for (const [condition, webhook, expected] of [[{ fact: "webhook", path: "$.items[*].x", operator: "contains", value: 2 }, { items: [{ x: 2 }] }, "match"], [{ fact: "webhook", path: "$.n", operator: "greaterThan", value: 2 }, { n: "10" }, "no-match"], [{ all: [] }, {}, "error"], [{ fact: "webhook", path: "$[?(@.x)]", operator: "equal", value: 1 }, {}, "error"]]) {
      const response = await worker.dispatchFetch("https://conditions.test", { method: "POST", body: JSON.stringify({ conditions: condition, webhook }) }); assert.equal((await response.json()).decision, expected);
    }
  } finally { await worker.dispose(); }
});
