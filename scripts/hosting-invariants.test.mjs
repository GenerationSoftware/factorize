import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("static cutover preserves the existing production Worker and state identities", () => {
  const baseline = JSON.parse(readFileSync(new URL("worker-infrastructure-baseline.json", import.meta.url)));
  const current = JSON.parse(readFileSync(new URL("../packages/api/wrangler.jsonc", import.meta.url)));
  const { assets: oldAssets, ...oldBackend } = baseline;
  const { assets, ...backend } = current;
  assert.deepEqual(backend, oldBackend);
  assert.equal(oldAssets.binding, assets.binding);
  assert.deepEqual(assets, { directory: "../app/dist", binding: "ASSETS", run_worker_first: true, not_found_handling: "none" });
});
