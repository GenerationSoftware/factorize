import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkInventory, checkContent } from "./content.mjs";
import { root, renderExports, syncExports } from "./exports.mjs";

test("all navigation pages and local links resolve and hosted contracts remain complete", checkContent);
test("inventory rejects a missing, invented, or duplicated tool", async () => {
  const implementation = await readFile(resolve(root, "../api/src/protected-api.ts"), "utf8");
  const reference = await readFile(resolve(root, "mcp/tools.mdx"), "utf8");
  for (const changed of [
    reference.replace(/^\| `get_run_diagnostics`.*\n/m, ""),
    reference + "\n| `invented_tool` | flows:read | {} |",
    reference + "\n| `get_run` | runs:read | {} |",
  ]) assert.throws(() => checkInventory(implementation, changed), /inventory differs/);
});
test("exports include every maintained guide, lifecycle edited and actionable MCP contracts", async () => {
  const exports = await renderExports();
  const full = exports["llms-full.txt"];
  for (const token of ["https://app.factorize.sh/mcp", "expectedUpdatedAt", "idempotencyKey", "get_run_diagnostics", "diagnose_exe_integration", "list_webhook_deliveries", "get_webhook_delivery", "edited"]) assert.ok(full.includes(token), token);
  assert.ok(full.indexOf("## Connect your agent") < full.indexOf("## REST API reference"));
  assert.ok(full.length > 40000);
  await syncExports(true);
});
