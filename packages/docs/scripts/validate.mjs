import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
for (const file of ["docs.json", "llms.txt", "llms-full.txt"]) await readFile(resolve(root, file));
execFileSync("npm", ["run", "check:openapi"], { cwd: resolve(root, "../.."), stdio: "inherit" });
execFileSync("npm", ["test", "--workspace=factorize", "--", "test/api-contract.test.ts"], { cwd: resolve(root, "../.."), stdio: "inherit" });
console.log("Validated generated OpenAPI, executable operation equality, Mintlify configuration, and LLM exports.");
