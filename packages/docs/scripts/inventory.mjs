import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tsImport } from "tsx/esm/api";
import { root } from "./exports.mjs";

const start = "{/* mcp-inventory:start */}";
const end = "{/* mcp-inventory:end */}";

// Use the same declarations the runtime registers, without parsing source or
// starting a Worker. Scope and registration remain owned by each capability.
export async function registeredTools() {
  const registry = new URL("../../api/src/transport/mcp/registry.ts", import.meta.url);
  const { listMcpToolMetadata } = await tsImport(registry.href, import.meta.url);
  return listMcpToolMetadata().map(({ name, description }) => [name, description])
    .sort(([left], [right]) => left.localeCompare(right));
}

function table(tools) {
  return [
    "| Tool | Description from MCP discovery |",
    "| --- | --- |",
    ...tools.map(([name, description]) => {
      const label = name === "list_cloudflare_tail_integrations" ? "Legacy; historical installations only. " : "";
      return "| `" + name + "` | " + label + description.replaceAll("|", "&#124;") + " |";
    }),
  ].join("\n");
}

export function renderInventory(tools, reference) {
  const [pre, rest, extra] = reference.split(start);
  const pieces = rest?.split(end);
  if (extra !== undefined || pieces?.length !== 2) throw new Error("Missing unique MCP inventory markers");
  return pre + start + "\n" + table(tools) + "\n" + end + pieces[1];
}

export function checkInventory(tools, reference) {
  const generated = renderInventory(tools, reference);
  const actual = [...reference.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]).filter(name => name.includes("_"));
  if (generated !== reference || JSON.stringify(actual) !== JSON.stringify(tools.map(([name]) => name))) {
    throw new Error("MCP inventory differs from registered tools");
  }
}

export async function syncInventory(check) {
  const path = resolve(root, "mcp/tools.mdx");
  const reference = await readFile(path, "utf8");
  const tools = await registeredTools();
  if (check) checkInventory(tools, reference);
  else await writeFile(path, renderInventory(tools, reference));
}
