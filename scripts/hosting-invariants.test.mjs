import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("static cutover preserves the existing production Worker and state identities", () => {
  const baseline = JSON.parse(readFileSync(new URL("worker-infrastructure-baseline.json", import.meta.url)));
  const current = JSON.parse(readFileSync(new URL("../packages/api/wrangler.jsonc", import.meta.url)));
  const { assets: oldAssets, r2_buckets: oldBuckets, ...oldBackend } = baseline;
  const { assets, routes, r2_buckets: buckets, ...backend } = current;
  assert.deepEqual(routes, [{ pattern: "app.factorize.sh", custom_domain: true }, { pattern: "git.factorize.sh", custom_domain: true }]);
  const { durable_objects: nextObjects, migrations: nextMigrations, build, observability, upload_source_maps, ...nextWorker } = backend;
  const { durable_objects: oldObjects, migrations: oldMigrations, ...oldWorker } = oldBackend;
  assert.deepEqual(nextWorker, oldWorker);
  assert.deepEqual(build, { command: "node scripts/prepare-worker-ssh.mjs" });
  assert.deepEqual(nextObjects.bindings, [...oldObjects.bindings, { name: "HETZNER_SSH", class_name: "HetznerSshBroker" }]);
  assert.deepEqual(nextMigrations, [...oldMigrations, { tag: "v7-hetzner-ssh-broker", new_sqlite_classes: ["HetznerSshBroker"] }]);
  assert.deepEqual(buckets, [{ binding: "PROXY_ARTIFACTS", bucket_name: oldBuckets[0].bucket_name }]);
  assert.equal(oldAssets.binding, assets.binding);
  assert.deepEqual(assets, { directory: "../app/dist", binding: "ASSETS", run_worker_first: true, not_found_handling: "none" });
});

test("Worker observability keeps automated request telemetry off", () => {
  const config = JSON.parse(readFileSync(new URL("../packages/api/wrangler.jsonc", import.meta.url)));
  assert.equal(config.upload_source_maps, true);
  assert.deepEqual(config.observability, {
    enabled: true,
    logs: { enabled: true, invocation_logs: false, redact_query_string: true },
    traces: { enabled: false },
    issues: { enabled: true },
  });
});
