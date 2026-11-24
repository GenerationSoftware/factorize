import assert from "node:assert/strict";
import test from "node:test";
import { purgeSkillArtifacts } from "./purge-skill-artifacts.mjs";

const accountId = "a".repeat(32);
const token = "test-token";
const envelope = (result, cursor, status = 200) => Response.json({
  success: true, result, result_info: { cursor },
}, { status });

test("inventories every page and only deletes from the dedicated namespace when applied", async () => {
  const repositories = new Set(["skills-current", "skills-orphaned"]);
  const deleted = [];
  const fetcher = async (url, { method }) => {
    assert.equal(url.origin, "https://api.cloudflare.com");
    const base = `/client/v4/accounts/${accountId}/artifacts/namespaces/factorize-skills/repos`;
    if (method === "DELETE") {
      assert.ok(url.pathname.startsWith(base + "/"));
      const name = url.pathname.slice(base.length + 1);
      deleted.push(name);
      repositories.delete(name);
      return envelope({ id: name }, null, 202);
    }
    assert.equal(url.pathname, base);
    const cursor = url.searchParams.get("cursor");
    const list = [...repositories];
    return cursor
      ? envelope(list.slice(1).map(name => ({ name })))
      : envelope(list.slice(0, 1).map(name => ({ name })), list.length > 1 ? "page-2" : null);
  };
  const options = { accountId, token, fetcher };
  assert.deepEqual(await purgeSkillArtifacts(options), ["skills-current", "skills-orphaned"]);
  assert.deepEqual(deleted, []);
  const applied = { ...options, apply: true };
  assert.deepEqual(await purgeSkillArtifacts(applied), ["skills-current", "skills-orphaned"]);
  assert.deepEqual(deleted, ["skills-current", "skills-orphaned"]);
  assert.deepEqual(await purgeSkillArtifacts(applied), []);
});

test("reports a deletion failure", async () => {
  const fetcher = async (_url, { method }) => method === "DELETE"
    ? new Response(null, { status: 403 })
    : envelope([{ name: "skills-current" }]);
  await assert.rejects(purgeSkillArtifacts({ accountId, token, fetcher, apply: true }), /Delete skills-current failed \(HTTP 403\)/);
});
