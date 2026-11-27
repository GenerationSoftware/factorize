import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { root } from "./exports.mjs";

const start = "{/* mcp-inventory:start */}";
const end = "{/* mcp-inventory:end */}";

// Follow the exact arrays consumed by the runtime registry, rather than
// scanning every file or importing Worker-only code into the docs builder.
export async function registeredTools() {
  const registryPath = resolve(root, "../api/src/transport/mcp/registry.ts");
  const parse = async path => ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
  function initializer(file, name) {
    return file.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
      .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)?.initializer;
  }
  function string(node) {
    return node && ts.isStringLiteralLike(node) ? node.text : undefined;
  }
  function describe(declaration) {
    if (ts.isCallExpression(declaration) && ts.isIdentifier(declaration.expression) && declaration.expression.text === "mcpTool") {
      return declaration.arguments.slice(1, 3).map(string);
    }
    // Native file import registers directly to retain the SDK attachment
    // metadata. Require its descriptor and registration to name the same tool.
    if (ts.isSatisfiesExpression(declaration) && ts.isObjectLiteralExpression(declaration.expression)) {
      const descriptor = declaration.expression;
      const name = descriptor.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText() === "name");
      let pair;
      const walk = node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "registerTool") {
          const [tool, options] = node.arguments;
          const description = options && ts.isObjectLiteralExpression(options) && options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText() === "description");
          if (description && string(tool) === string(name?.initializer)) pair = [string(tool), string(description.initializer)];
        }
        ts.forEachChild(node, walk);
      };
      walk(descriptor);
      return pair;
    }
  }
  const registry = await parse(registryPath);
  const imports = new Map();
  for (const node of registry.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const binding = node.importClause?.namedBindings;
    const module = string(node.moduleSpecifier);
    if (module?.startsWith(".") && binding && ts.isNamedImports(binding)) {
      for (const specifier of binding.elements) imports.set(specifier.name.text,
        [resolve(dirname(registryPath), module + ".ts"), specifier.propertyName?.text ?? specifier.name.text]);
    }
  }
  const catalog = initializer(registry, "tools");
  const corrupt = () => { throw new Error("Cannot derive inventory from MCP registry"); };
  if (!catalog || !ts.isArrayLiteralExpression(catalog)) corrupt();
  const files = new Map();
  const tools = [];
  for (const element of catalog.elements) {
    if (!ts.isSpreadElement(element) || !ts.isIdentifier(element.expression)) corrupt();
    const entry = imports.get(element.expression.text);
    if (!entry) corrupt();
    const [path, name] = entry;
    if (!files.has(path)) files.set(path, await parse(path));
    const list = initializer(files.get(path), name);
    if (!list || !ts.isArrayLiteralExpression(list)) corrupt();
    for (const declaration of list.elements) {
      const pair = describe(declaration);
      if (!pair || pair.length !== 2 || !pair.every(value => typeof value === "string" && value.length)) corrupt();
      tools.push(pair);
    }
  }
  if (!tools.length || new Set(tools.map(([name]) => name)).size !== tools.length) corrupt();
  return tools.sort(([a], [b]) => a.localeCompare(b));
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
