import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { navigationGroups, root } from "./exports.mjs";
import { registeredTools, syncInventory } from "./inventory.mjs";

const pathways = [
  { title: "Use an API", file: "work/use-an-api", skill: "use-an-api", tools: ["get_api_reflection", "request_api", "get_api_operation"], scopes: ["proxy:use"] },
  { title: "Give a VM access", file: "work/vm-access", skill: "grant-vm-access", tools: ["grant_vm_permissions", "list_vms", "revoke_vm_permissions"], scopes: ["vms:read", "vms:edit", "triggers:read"] },
  { title: "React to an event", file: "work/triggers", skill: "manage-triggers", tools: ["create_event", "create_trigger", "fire_trigger", "list_event_occurrences"], scopes: ["triggers:read", "triggers:write"] },
];
const headingSlug = title => title.toLowerCase().replace(/[^a-z0-9 -]/g, "").replaceAll(" ", "-");

function checkLink(link, guides, name) {
  const [rawPage, anchor] = link.split("#");
  const page = rawPage.slice(1) || "index";
  const guide = guides.get(page);
  if (!guide && page !== "openapi.yaml") throw new Error("Unknown guide linked from " + name + ": " + link);
  const headings = [...(guide ?? "").matchAll(/^#{1,6} (.+)$/gm)].map(([, h]) => headingSlug(h));
  if (anchor && !headings.includes(anchor)) throw new Error("Unknown anchor linked from " + name + ": " + link);
}

export async function checkContent() {
  const config = JSON.parse(await readFile(resolve(root, "docs.json"), "utf8"));
  const groups = navigationGroups(config);
  if (JSON.stringify(config.navigation.tabs.map(tab => tab.tab)) !== '["Guides","Operators"]') throw new Error("Keep operator setup separate from the first task");
  const first = config.navigation.tabs[0].groups[0].pages;
  if (JSON.stringify(first) !== '["index","quickstart","mcp/overview"]') throw new Error("First task must follow the home page");
  const recipes = groups.find(g => g.group === "Work with your agent")?.pages;
  if (JSON.stringify(recipes) !== JSON.stringify(pathways.map(p => p.file))) throw new Error("Missing agent pathway");
  const pages = groups.flatMap(g => g.pages).filter(page => typeof page === "string");
  if (new Set(pages).size !== pages.length) throw new Error("Duplicate navigation page");
  const rest = groups.find(g => g.group === "Reference").pages.find(page => page.openapi);
  if (rest?.openapi !== "/openapi.yaml") throw new Error("Missing rendered REST contract");
  const guides = new Map(await Promise.all(pages.map(async name => [name, await readFile(resolve(root, name + ".mdx"), "utf8")])));
  for (const [name, body] of guides) {
    if (!/^---\ntitle: .+\ndescription: .+\n---\n/.test(body)) throw new Error("Invalid frontmatter: " + name);
    for (const [, link] of body.matchAll(/(?:\]\(|href=")(\/[^\s)"]+)/g)) checkLink(link, guides, name);
  }
  for (const redirect of config.redirects ?? []) checkLink(redirect.destination, guides, redirect.source);
  const main = first.map(name => guides.get(name)).join("\n");
  for (const url of ["https://app.factorize.sh", "https://app.factorize.sh/mcp"]) if (!main.includes(url)) throw new Error("Missing hosted URL");
  const quickstart = guides.get("quickstart");
  const tools = new Set((await registeredTools()).map(([name]) => name));
  for (const { title, file, skill, tools: required, scopes } of pathways) {
    const section = quickstart.split("## " + title + "\n")[1]?.split("\n## ")[0];
    if (!section?.includes("\n> ") || !section.includes("](/" + file + ")")) throw new Error("Missing prompt or agent link: " + title);
    const guide = guides.get(file);
    for (const tool of required) if (!tools.has(tool) || !guide.includes("`" + tool + "`")) throw new Error("Missing registered recipe tool: " + tool);
    for (const scope of scopes) if (!guide.includes("`" + scope + "`")) throw new Error("Missing recipe scope: " + scope);
    const source = await readFile(resolve(root, "../../skills", skill, "SKILL.md"), "utf8");
    const links = [...source.matchAll(/\]\(https:\/\/docs\.factorize\.sh(\/[^)]+)\)/g)].map(([, link]) => link);
    if (!links.includes("/" + file) || !links.some(link => link.startsWith("/mcp/tools#"))) throw new Error("Missing skill guide or reference: " + skill);
    for (const link of links) checkLink(link, guides, skill);
    for (const [ , symbol ] of source.matchAll(/`([a-z][a-z_]*_[a-z_]+)`/g)) if (!tools.has(symbol)) throw new Error("Unregistered skill tool: " + symbol);
  }
  const reference = guides.get("mcp/tools");
  for (const phrase of ["resource-updated notification", "factorize://events/", "duplicate", "idempotencyKey"]) if (!reference.includes(phrase)) throw new Error("Missing Event/Trigger contract detail: " + phrase);
  for (const method of ["skills/list", "skills/get"]) if (!guides.get("mcp/overview").includes(method)) throw new Error("Missing built-in MCP Skills documentation: " + method);
  await syncInventory(true);
  console.log("Validated " + pages.length + " pages, recipe and skill links, redirects, and registered MCP inventory.");
}
