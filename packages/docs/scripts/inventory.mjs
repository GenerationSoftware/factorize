import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root } from "./exports.mjs";

const start = "{/* mcp-inventory:start */}";
const end = "{/* mcp-inventory:end */}";

export function registeredTools(implementation) {
  const names = [...implementation.matchAll(/\b(?:tool|registerTool)\("([^"]+)"/g)].map(match => match[1]);
  const declarations = [...implementation.matchAll(/\b(?:tool|registerTool)\("([^"]+)",\s*(?:\{\s*description:\s*)?("(?:[^"\\]|\\.)*")/g)];
  const tools = declarations.map(([, name, description]) => [name, JSON.parse(description)]);
  if (!names.length || names.length !== tools.length || new Set(names).size !== names.length) {
    throw new Error("Cannot derive inventory from MCP registry");
  }
  return tools.sort(([a], [b]) => a.localeCompare(b));
}

function table(implementation) {
  return [
    "| Tool | Description from MCP discovery |",
    "| --- | --- |",
    ...registeredTools(implementation).map(([name, description]) => {
      const label = name === "list_cloudflare_tail_integrations" ? "Legacy; historical installations only. " : "";
      return "| `" + name + "` | " + label + description.replaceAll("|", "&#124;") + " |";
    }),
  ].join("\n");
}

export function renderInventory(implementation, reference) {
  const [pre, rest, extra] = reference.split(start);
  const pieces = rest?.split(end);
  if (extra !== undefined || pieces?.length !== 2) throw new Error("Missing unique MCP inventory markers");
  return pre + start + "\n" + table(implementation) + "\n" + end + pieces[1];
}

export function checkInventory(implementation, reference) {
  const generated = renderInventory(implementation, reference);
  const actual = [...reference.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]).filter(name => name.includes("_"));
  if (generated !== reference || JSON.stringify(actual) !== JSON.stringify(registeredTools(implementation).map(([name]) => name))) {
    throw new Error("MCP inventory differs from registered tools");
  }
}

export async function syncInventory(check) {
  const path = resolve(root, "mcp/tools.mdx");
  const reference = await readFile(path, "utf8");
  const implementation = await readFile(resolve(root, "../api/src/protected-api.ts"), "utf8");
  if (check) checkInventory(implementation, reference);
  else await writeFile(path, renderInventory(implementation, reference));
}
