import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root } from "./exports.mjs";

export function checkInventory(implementation, reference) {
  const actual = [...implementation.matchAll(/\b(?:tool|registerTool)\("([^"]+)"/g)].map(match => match[1]).sort();
  const documented = [...reference.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]).filter(name => name.includes("_")).sort();
  if (!actual.length || JSON.stringify(actual) !== JSON.stringify(documented)) throw new Error("MCP inventory differs from registered tools");
}

export async function checkContent() {
  const config = JSON.parse(await readFile(resolve(root, "docs.json"), "utf8"));
  const groups = config.navigation.groups;
  const expected = ["Get started", "Work with your agent", "Automate triggers", "Troubleshooting", "Reference", "Self-hosting"];
  if (JSON.stringify(groups.map(g => g.group)) !== JSON.stringify(expected)) throw new Error("Task navigation order changed");
  const pages = groups.flatMap(g => g.pages).filter(page => typeof page === "string");
  const rest = groups.find(group => group.group === "Reference").pages.find(page => page.openapi);
  if (rest?.openapi !== "/openapi.yaml") throw new Error("Missing rendered REST contract");
  if (new Set(pages).size !== pages.length) throw new Error("Duplicate navigation page");
  const guides = new Map(await Promise.all(pages.map(async name => [name, await readFile(resolve(root, name + ".mdx"), "utf8")])));
  for (const [name, body] of guides) {
    if (!/^---\ntitle: .+\ndescription: .+\n---\n/.test(body)) throw new Error(`Invalid frontmatter: ${name}`);
    for (const match of body.matchAll(/(?:\]\(|href=")(\/[^)"#]+)(?:#[^)" ]*)?/g)) {
      const link = match[1].slice(1);
      if (!pages.includes(link)) await readFile(resolve(root, link));
    }
  }
  const main = ["index", "quickstart", "mcp/overview"].map(name => guides.get(name)).join("\n");
  for (const url of ["https://app.factorize.sh", "https://app.factorize.sh/mcp"]) if (!main.includes(url)) throw new Error("Missing hosted URL");
  for (const phrase of ["create_event", "create_trigger", "fire_trigger", "list_event_occurrences", "idempotencyKey", "Subscribe"]) if (!guides.get("quickstart").includes(phrase)) throw new Error(`Incomplete Event walkthrough: ${phrase}`);
  const reference = guides.get("mcp/tools");
  checkInventory(await readFile(resolve(root, "../api/src/protected-api.ts"), "utf8"), reference);
  for (const phrase of ["resource-updated notification", "factorize://events/", "duplicate", "standalone"]) if (!reference.includes(phrase)) throw new Error(`Missing Event/Trigger contract detail: ${phrase}`);
  const readme = await readFile(resolve(root, "../../README.md"), "utf8");
  if (!readme.includes("https://app.factorize.sh/mcp") || readme.indexOf("Optional self-hosting") < readme.indexOf("Connect a supported")) throw new Error("README positioning drift");
  console.log(`Validated ${pages.length} navigation pages, local links, hosted Event workflow and complete MCP inventory.`);
}
