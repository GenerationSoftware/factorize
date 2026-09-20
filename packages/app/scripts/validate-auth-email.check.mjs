import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePostmark } from "./validate-auth-email.mjs";
const config = { APP_ORIGIN: "https://app.example.test", POSTMARK_SERVER_TOKEN: "test", POSTMARK_FROM_EMAIL: "accounts@example.test", POSTMARK_MESSAGE_STREAM: "outbound" };
test("Postmark preflight fails closed for missing settings, wrong stream and unverified sender", async () => {
  for (const field of Object.keys(config)) await assert.rejects(validatePostmark({ ...config, [field]: "" }), /Configure/);
  await assert.rejects(validatePostmark({ ...config, APP_ORIGIN: "http://app.example.test" }), /HTTPS/);
  await assert.rejects(validatePostmark(config, async () => Response.json({ MessageStreamType: "Broadcasts" })), /transactional/);
  await assert.rejects(validatePostmark(config, async () => Response.json({ MessageStreamType: "Transactional", ArchivedAt: "2026-01-01" })), /transactional/);
  await assert.rejects(validatePostmark(config, async url => url.endsWith("/email") ? Response.json({ ErrorCode: 400 }, { status: 422 }) : Response.json({ MessageStreamType: "Transactional" })), /sender/);
});
test("Postmark preflight uses the configured stream and validates an actual send to the sender", async () => {
  let sent = false;
  await validatePostmark(config, async (url, init) => {
    assert.equal(init.headers["X-Postmark-Server-Token"], config.POSTMARK_SERVER_TOKEN);
    if (!url.endsWith("/email")) { assert.ok(url.endsWith("/outbound")); return Response.json({ MessageStreamType: "Transactional", ArchivedAt: null }); }
    const body = JSON.parse(init.body); assert.equal(body.From, config.POSTMARK_FROM_EMAIL); assert.equal(body.To, config.POSTMARK_FROM_EMAIL); assert.equal(body.MessageStream, "outbound"); sent = true;
    return Response.json({ ErrorCode: 0 });
  });
  assert.equal(sent, true);
});
