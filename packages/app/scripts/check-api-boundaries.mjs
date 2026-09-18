import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("{src,test}/**/*.{ts,tsx,js,mjs}", { cwd: new URL("..", import.meta.url) });
const failures = [];
for (const file of files) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of source.matchAll(/["'`]\/api\/(?!v1(?:\/|["'`]))[^"'`]*/g)) failures.push(`${file}: unversioned API reference ${match[0]}`);
  if (file !== "src/protected-api.ts" && /app\.(?:get|post|put|patch|delete|all)\(["'`]\/api\//.test(source)) failures.push(`${file}: API routes may only be registered in src/protected-api.ts`);
}
const contract = readFileSync(new URL("../src/api-contract.ts", import.meta.url), "utf8");
const openapi = readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8");
for (const [, path] of contract.matchAll(/\["(?:GET|POST|PUT|PATCH|DELETE)", "([^"]+)"\]/g)) if (!openapi.includes(`  ${path}:`)) failures.push(`OpenAPI is missing ${path}`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`API boundaries verified across ${files.length} source and test files.`);
