import { readFileSync, writeFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";

const target = new URL("../src/schema.d.ts", import.meta.url);
const contract = new URL("../../docs/openapi.yaml", import.meta.url);
const output = "// Generated from packages/docs/openapi.yaml. Do not edit.\n" +
  astToString(await openapiTS(contract));
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) {
    console.error("API client is stale. Run npm run generate:client.");
    process.exitCode = 1;
  }
} else writeFileSync(target, output);
