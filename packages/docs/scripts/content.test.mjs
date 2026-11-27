import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkInventory, registeredTools } from "./inventory.mjs";
import { checkContent } from "./content.mjs";
import { root, renderExports, syncExports } from "./exports.mjs";

test("navigation, three pathways, skill links, redirects and contracts remain complete", checkContent);
test("MCP inventory rejects a missing, invented, or duplicated tool", async () => {
  const tools = await registeredTools();
  const reference = await readFile(resolve(root, "mcp/tools.mdx"), "utf8");
  for (const changed of [
    reference.replace(/^\| `create_event`.*\n/m, ""),
    reference + "\n| `invented_tool` | Invented tool |",
    reference + "\n| `get_event` | Duplicate |",
  ]) assert.throws(() => checkInventory(tools, changed), /inventory differs/);
});
test("generated exports include all three recipes, operator setup and registered inventory", async () => {
  const exports = await renderExports();
  const full = exports["llms-full.txt"];
  for (const token of ["https://app.factorize.sh/mcp", "request_api", "grant_vm_permissions", "create_event", "fire_trigger", "list_event_occurrences", "factorize://events/"]) assert.ok(full.includes(token), token);
  for (const guide of ["work/use-an-api", "work/vm-access", "work/triggers", "self-hosting/deployment"]) assert.ok(exports["llms.txt"].includes(guide), guide);
  assert.ok(full.indexOf("## Your first steps") < full.indexOf("## REST operations"));
  assert.ok(!full.includes("mcp-inventory:start"));
  await syncExports(true);
});
