import { access } from "node:fs/promises";
import process from "node:process";
import { runProcess } from "./portable-proxy-test-helpers.mjs";

const lane = process.argv[2] ?? "all";
const expectedNode = "24.12.0";
const suiteTimeoutMs = 540_000;
const lanes = {
  backend: [
    ["generated contracts", "npm", ["run", "generate"], 90_000],
    ["generated contract drift", "git", ["diff", "--exit-code", "--", "packages/docs/openapi.yaml", "packages/api-client/src/schema.d.ts"], 15_000],
    ["application build", "npm", ["run", "build", "--workspace=factorize-app"], 90_000],
    ["backend checks", "npm", ["run", "check:backend"], 240_000],
    ["compiled app/API/PostgreSQL integration", "npm", ["run", "test:static-slice", "--workspace=factorize"], 90_000],
  ],
  browser: [
    ["application build", "npm", ["run", "build", "--workspace=factorize-app"], 90_000],
    ["Chromium availability", process.execPath, ["scripts/validation.mjs", "--check-chromium"], 15_000],
    ["functional browser checks", "npm", ["run", "test:functional", "--workspace=factorize-app"], 90_000],
    ["application unit checks", "npm", ["test", "--workspace=factorize-app"], 180_000],
  ],
  proxy: [
    ["portable proxy harness checks", process.execPath, ["--test", "scripts/validation-runner.test.mjs"], 30_000],
    ["credential proxy process checks", process.execPath, ["--test", "packages/credential-proxy/test/runtime-process.test.mjs"], 30_000],
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

if (!["all", "backend", "browser", "proxy"].includes(lane)) {
  console.error(`Unknown validation lane: ${lane}. Use all, backend, browser, or proxy.`);
  process.exit(2);
}

const results = [];
const cancellation = new AbortController();
let receivedSignal;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    receivedSignal = signal;
    console.error(`Validation interrupted by ${signal}; stopping the active process tree.`);
    cancellation.abort(signal);
  });
}
const suiteDeadline = setTimeout(() => {
  console.error("Validation exceeded its 540 second suite deadline.");
  cancellation.abort("timeout");
}, suiteTimeoutMs);

const run = async (name, command, args, timeoutMs) => {
  const result = await runProcess(command, args, {
    timeoutMs,
    signal: cancellation.signal,
    onOutput: (stream, chunk) => (stream === "stderr" ? process.stderr : process.stdout).write(chunk),
  });
  if (result.timedOut) console.error(`${name}: exceeded its ${timeoutMs}ms deadline; process tree stopped.`);
  else if (result.aborted) console.error(`${name}: stopped after ${result.signal}.`);
  else if (result.error) console.error(`${name}: ${result.error.message}`);
  return result.code;
};

if (!/^v?24\.(1[2-9]|[2-9][0-9])\./.test(process.version)) {
  console.error(`Node ${expectedNode} or newer in the 24.x line is required; found ${process.version}. Recover with: nvm install ${expectedNode} && nvm use ${expectedNode} && npm ci`);
  process.exit(1);
}

if (lane === "all" || lane === "backend") {
  const missing = ["DATABASE_URL", "AUTH_TEST_DATABASE_URL", "QUEUE_TEST_DATABASE_URL"].filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Backend validation requires an isolated PostgreSQL database (${missing.join(", ")}). Recover with: npm run bootstrap:test`);
    process.exit(1);
  }
}

const selected = lane === "all" ? ["backend", "browser", "proxy"] : [lane];
try {
  for (const selectedLane of selected) {
    console.log(`\n=== ${selectedLane} validation ===`);
    for (const [name, command, args, timeoutMs] of lanes[selectedLane]) {
      const code = await run(name, command, args, timeoutMs);
      results.push({ lane: selectedLane, name, status: code === 0 ? "passed" : "failed" });
      if (code !== 0) {
        for (const pending of lanes[selectedLane].slice(results.filter((item) => item.lane === selectedLane).length)) {
          results.push({ lane: selectedLane, name: pending[0], status: "not run" });
        }
        break;
      }
      if (cancellation.signal.aborted) break;
    }
    if (cancellation.signal.aborted) break;
  }
} finally {
  clearTimeout(suiteDeadline);
}

console.log("\n=== validation summary ===");
for (const result of results) console.log(`${result.status.padEnd(8)} ${result.lane}: ${result.name}`);
if (receivedSignal) process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 })[receivedSignal]);
if (results.some(({ status }) => status === "failed" || status === "not run") || cancellation.signal.aborted) process.exit(1);
