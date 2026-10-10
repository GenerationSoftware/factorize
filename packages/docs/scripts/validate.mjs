import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkContent } from "./content.mjs";
import { syncExports } from "./exports.mjs";

await checkContent();
await syncExports(true);
execFileSync(process.execPath, ["--test", "scripts/content.test.mjs"], { cwd: resolve(import.meta.dirname, ".."), stdio: "inherit" });
execFileSync("npm", ["run", "check:openapi"], { cwd: resolve(import.meta.dirname, "../../.."), stdio: "inherit" });
execFileSync("npm", ["test", "--workspace=factorize", "--", "test/api-contract.test.ts", "test/docs-workflows.test.ts"], { cwd: resolve(import.meta.dirname, "../../.."), stdio: "inherit" });
console.log("Validated OpenAPI, documentation example contracts, navigation/links, MCP inventory and generated exports.");
