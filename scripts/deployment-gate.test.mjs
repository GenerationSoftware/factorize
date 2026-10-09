import { test } from "node:test";
import assert from "node:assert/strict";
import { requireApiReady, STATIC_CONTRACT } from "./verify-public-routing.mjs";
test("deployment refuses old/missing contracts before frontend cutover", async () => {
  for (const response of [Response.json({ authenticated: false }, { status: 401 }), Response.json({ authenticated: false })]) await assert.rejects(requireApiReady("https://app.factorize.sh", async () => response), /Deploy API compatibility stage/);
  await requireApiReady("https://app.factorize.sh", async () => Response.json({ authenticated: false }, { headers: { "X-Factorize-Contract": STATIC_CONTRACT } }));
});
