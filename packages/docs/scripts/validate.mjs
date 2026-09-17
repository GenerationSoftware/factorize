import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const api = await readFile(resolve(root, "openapi.yaml"), "utf8");
const worker = await readFile(resolve(root, "../app/src/protected-api.ts"), "utf8");
const expected = ["exe-connections", "github-installations", "execution-targets", "job-trigger-availability", "integrations/cloudflare-tail", "jobs", "job-handlers/test", "runs", "schedules/preview"];
const missing = expected.filter(path => !api.includes(path) || !worker.includes(path));
for (const file of ["docs.json", "llms.txt", "llms-full.txt"]) await readFile(resolve(root, file));
if (missing.length) throw new Error(`Documentation route inventory is stale: ${missing.join(", ")}`);
console.log(`Validated ${expected.length} route families, Mintlify config, and LLM exports.`);
