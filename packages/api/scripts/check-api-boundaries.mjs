import { fileURLToPath } from "node:url";
import { capabilityBoundaryViolations } from "./capability-boundaries.mjs";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("{src,test}/**/*.{ts,tsx,js,mjs}", { cwd: new URL("..", import.meta.url) });
const failures = [];
for (const file of files) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  if (file.startsWith("src/") && /\bredirect\s*:\s*["'`]error["'`]/.test(source)) {
    failures.push(`${file}: Workers does not implement redirect: "error"; use fetchWithoutRedirects`);
  }
  if (file.startsWith("src/")) failures.push(...capabilityBoundaryViolations(
    fileURLToPath(new URL(`../${file}`, import.meta.url)), source,
    fileURLToPath(new URL("../src", import.meta.url)),
  ));
  for (const match of source.matchAll(/["'`]\/api\/(?!v1(?:\/|["'`]))[^"'`]*/g)) failures.push(`${file}: unversioned API reference ${match[0]}`);
  if (file !== "src/protected-api.ts" && /app\.(?:get|post|put|patch|delete|all)\(["'`]\/api\//.test(source)) failures.push(`${file}: API routes may only be registered in src/protected-api.ts`);
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`API boundaries verified across ${files.length} source and test files.`);
