import { test } from "node:test";
import assert from "node:assert/strict";
import { requireApiReady, STATIC_CONTRACT, waitForPublicRouting } from "./verify-public-routing.mjs";
test("deployment refuses old/missing contracts before frontend cutover", async () => {
  for (const response of [Response.json({ authenticated: false }, { status: 401 }), Response.json({ authenticated: false })]) await assert.rejects(requireApiReady("https://app.factorize.sh", async () => response), /Deploy API compatibility stage/);
  await requireApiReady("https://app.factorize.sh", async () => Response.json({ authenticated: false }, { headers: { "X-Factorize-Contract": STATIC_CONTRACT } }));
});
test("post-deploy verification waits for propagation but still fails persistent contract violations", async () => {
  let calls = 0, waits = 0;
  await waitForPublicRouting("https://app.factorize.sh", async () => { if (++calls < 3) throw new Error("prior Worker"); }, async ms => { assert.equal(ms, 5000); waits++; }, 3);
  assert.equal(calls, 3); assert.equal(waits, 2);
  const violation = new Error("missing security header");
  calls = 0;
  await assert.rejects(waitForPublicRouting("https://app.factorize.sh", async () => { calls++; throw violation; }, async () => {}, 3), error => error === violation);
  assert.equal(calls, 3);
});
