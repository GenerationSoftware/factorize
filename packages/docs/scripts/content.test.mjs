import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkInventory, checkContent } from "./content.mjs";
import { root, renderExports, syncExports } from "./exports.mjs";

test("navigation, Event workflow, links, and hosted contracts remain complete", checkContent);
test("MCP inventory rejects a missing, invented, or duplicated tool", async () => {
  const implementation = await readFile(resolve(root, "../api/src/protected-api.ts"), "utf8");
  const reference = await readFile(resolve(root, "mcp/tools.mdx"), "utf8");
  for (const changed of [
    reference.replace(/^\| `create_event`.*\n/m, ""),
    reference + "\n| `invented_tool` | scope | {} |",
    reference + "\n| `get_event` | scope | {} |",
  ]) assert.throws(() => checkInventory(implementation, changed), /inventory differs/);
});
test("generated exports include the Event workflow and registered MCP inventory", async () => {
  const exports = await renderExports();
  const full = exports["llms-full.txt"];
  for (const token of ["https://app.factorize.sh/mcp", "create_event", "fire_trigger", "list_event_occurrences", "list_webhook_deliveries", "factorize://events/"]) assert.ok(full.includes(token), token);
  assert.ok(full.indexOf("## Connect your agent") < full.indexOf("## REST operations"));
  assert.ok(full.length > 4000);
  await syncExports(true);
});
