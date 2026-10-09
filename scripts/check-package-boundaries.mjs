import { readFileSync, realpathSync, globSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["api", "app", "api-client"];
const failures = [];
const inside = (path, directory) => path === directory || path.startsWith(directory + sep);
for (const name of packages) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
  if (name !== "api") {
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (dependency === "factorize" || dependency.startsWith("@cloudflare/") || dependency === "pg" || dependency === "drizzle-orm") {
        failures.push(`${name}: server-only dependency ${dependency}`);
      }
    }
  }
  const config = ts.readConfigFile(resolve(directory, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, directory).options;
  for (const file of globSync("**/*.{ts,tsx,js,mjs,mts,cts}", { cwd: directory, exclude: ["node_modules/**", "dist/**", ".wrangler/**"] })) {
    const absolute = resolve(directory, file);
    const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
    const check = specifier => {
      if (name !== "api" && file.startsWith("src/") && (specifier.startsWith("cloudflare:") || specifier.startsWith("@cloudflare/") || specifier === "pg" || specifier === "drizzle-orm" || specifier.startsWith("node:"))) failures.push(`${name}/${file}: server-only import ${specifier}`);
      const backend = specifier === "factorize" || specifier.startsWith("factorize/");
      const frontend = specifier === "factorize-app" || specifier.startsWith("factorize-app/");
      if ((name !== "api" && backend) || (name === "api" && frontend)) failures.push(`${name}/${file}: forbidden package import ${specifier}`);
      const module = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule;
      const target = module ? realpathSync(module.resolvedFileName) : specifier.startsWith(".") ? resolve(dirname(absolute), specifier) : undefined;
      if (!target) return;
      for (const other of packages.filter(p => p !== name)) {
        if (!inside(target, resolve(root, "packages", other))) continue;
        if (name === "app" && other === "api-client" && specifier === "factorize-api-client") return;
        failures.push(`${name}/${file}: cross-package implementation import ${specifier} -> ${relative(root, target)}`);
      }
    };
    const visit = node => {
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) check(node.moduleReference.expression.text);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) check(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) check(node.argument.literal.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) check(argument.text);
        else if (name !== "api") failures.push(`${name}/${file}: nonliteral module import cannot be checked`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Frontend, generated client and API package import boundaries verified.");
