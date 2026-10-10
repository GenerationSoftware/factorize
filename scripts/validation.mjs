import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";

const lane = process.argv[2] ?? "all";
const expectedNode = "24.12.0";
const lanes = {
  backend: [
    ["generated contracts", "npm", ["run", "generate"]],
    ["generated contract drift", "git", ["diff", "--exit-code", "--", "packages/docs/openapi.yaml", "packages/api-client/src/schema.d.ts"]],
    ["application build", "npm", ["run", "build", "--workspace=factorize-app"]],
    ["backend checks", "npm", ["run", "check:backend"]],
    ["compiled app/API/PostgreSQL integration", "npm", ["run", "test:static-slice", "--workspace=factorize"]],
  ],
  browser: [
    ["application build", "npm", ["run", "build", "--workspace=factorize-app"]],
    ["Chromium availability", process.execPath, ["scripts/validation.mjs", "--check-chromium"]],
    ["functional browser checks", "npm", ["run", "test:functional", "--workspace=factorize-app"]],
    ["application unit checks", "npm", ["test", "--workspace=factorize-app"]],
  ],
};

if (lane === "--check-chromium") {
  try {
    const { chromium } = await import("@playwright/test");
    await access(chromium.executablePath());
  } catch {
    console.error("Chromium is required but was not found. Recover with: npm exec --workspace=factorize-app -- playwright install --with-deps chromium");
    process.exit(1);
  }
  process.exit(0);
}

if (!["all", "backend", "browser"].includes(lane)) {
  console.error(`Unknown validation lane: ${lane}. Use all, backend, or browser.`);
  process.exit(2);
}

const results = [];
const run = (name, command, args) => new Promise((resolve) => {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  child.on("error", (error) => { console.error(`${name}: ${error.message}`); resolve(127); });
  child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});

if (!/^v?24\.(1[2-9]|[2-9][0-9])\./.test(process.version)) {
  console.error(`Node ${expectedNode} or newer in the 24.x line is required; found ${process.version}. Recover with: nvm install ${expectedNode} && nvm use ${expectedNode} && npm ci`);
  process.exit(1);
}

if (lane !== "browser") {
  const missing = ["DATABASE_URL", "AUTH_TEST_DATABASE_URL", "QUEUE_TEST_DATABASE_URL"].filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Backend validation requires an isolated PostgreSQL database (${missing.join(", ")}). Recover with: npm run bootstrap:test`);
    process.exit(1);
  }
}

const selected = lane === "all" ? ["backend", "browser"] : [lane];
for (const selectedLane of selected) {
  console.log(`\n=== ${selectedLane} validation ===`);
  for (const [name, command, args] of lanes[selectedLane]) {
    const code = await run(name, command, args);
    results.push({ lane: selectedLane, name, status: code === 0 ? "passed" : "failed" });
    if (code !== 0) {
      for (const pending of lanes[selectedLane].slice(results.filter((item) => item.lane === selectedLane).length)) {
        results.push({ lane: selectedLane, name: pending[0], status: "not run" });
      }
      break;
    }
  }
}

console.log("\n=== validation summary ===");
for (const result of results) console.log(`${result.status.padEnd(8)} ${result.lane}: ${result.name}`);
if (results.some(({ status }) => status === "failed" || status === "not run")) process.exit(1);
