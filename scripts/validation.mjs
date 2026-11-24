import { access } from "node:fs/promises";
import { availableParallelism } from "node:os";
import process from "node:process";
import { runProcess } from "./portable-proxy-test-helpers.mjs";
import { scheduleValidation } from "./validation-scheduler.mjs";

const lane = process.argv[2] ?? "all";
const expectedNode = "24.21.0";
const prebuilt = ["api", "browser", "worker"].includes(lane) && process.argv.includes("--prebuilt");

if (lane === "artifacts") {
  for (const file of ["packages/app/dist/index.html", "packages/app/dist/assets"]) await access(file);
  process.exit(0);
}

if (lane === "--check-database") {
  const { verifyTestDatabase } = await import("./test-database.mjs");
  await verifyTestDatabase(process.env.AUTH_TEST_DATABASE_URL);
  process.exit(0);
}

if (lane === "--check-chromium") {
  try {
    const { chromium } = await import("@playwright/test");
    await access(chromium.executablePath());
  } catch {
    console.error("Chromium is required. Use the Factorize validation runner image or the browser CI setup.");
    process.exit(1);
  }
  process.exit(0);
}

const shard = lane === "api" ? process.env.FACTORIZE_API_SHARD : undefined;
if (shard && (!/^\d+\/\d+$/.test(shard) || Number(shard.split("/")[0]) < 1 ||
    Number(shard.split("/")[0]) > Number(shard.split("/")[1]))) {
  throw new Error("FACTORIZE_API_SHARD must be an index and count such as 1/2.");
}

const workspace = (name, ...args) => [...args, "--workspace=" + name];
const npm = (id, name, args, timeout = 90_000, after) =>
  ({ id, name, command: "npm", args, timeout, after });
const node = (id, name, args, timeout = 90_000) =>
  ({ id, name, command: process.execPath, args, timeout });
const bun = (name) => ({
  id: "type-" + name,
  name: name + " type check (Bun)",
  command: "bun",
  args: ["check", "--no-script", "--project", "packages/" + name],
  timeout: 90_000,
});

const build = prebuilt
  ? node("build", "shared app build artifact", ["scripts/validation.mjs", "artifacts"])
  : npm("build", "application bundle", workspace("factorize-app", "run", "bundle"));
const database = node("database", "PostgreSQL test template", ["scripts/validation.mjs", "--check-database"], 15_000);
const api = [npm("api", "API Vitest suite", [
  ...workspace("factorize", "test"), ...(shard ? ["--", "--shard=" + shard] : []),
], 240_000, ["build", "database"])];
const browser = [
  node("chromium", "Chromium availability", ["scripts/validation.mjs", "--check-chromium"], 15_000),
  npm("browser", "frontend Playwright suite", workspace("factorize-app", "test"), 180_000, ["build", "chromium"]),
];
const staticChecks = [
  ...["api", "app", "api-client", "tail-relay"].map(bun),
  npm("skills", "built-in skills drift", ["run", "check:skills"]),
  npm("contract", "OpenAPI drift", ["run", "check:openapi"]),
  npm("client", "generated client drift", workspace("factorize-api-client", "run", "check:generated")),
  npm("boundaries", "package boundaries", ["run", "check:boundaries"]),
  npm("api-boundaries", "API boundaries", workspace("factorize", "run", "check:api-boundaries")),
  npm("hosting", "hosting and deployment invariants", ["run", "check:hosting"]),
  npm("docs", "documentation validation", workspace("factorize-docs", "run", "validate")),
  node("email", "auth email preflight", ["--test", "packages/api/scripts/validate-auth-email.check.mjs"]),
  node("skill-purge", "team Skills Artifacts purge", ["--test", "scripts/purge-skill-artifacts.test.mjs"]),
  node("harness", "portable proxy harness", ["--test", "scripts/validation-runner.test.mjs"], 30_000),
];
if (process.env.FACTORIZE_COMPARE_TYPECHECK === "1") {
  staticChecks.push(...["api", "app", "api-client", "tail-relay"].map(name => node(
    "reference-" + name, name + " type check (reference TypeScript)",
    ["node_modules/typescript/bin/tsc", "--noEmit", "--project", "packages/" + name],
  )));
}
const worker = [
  npm("runtime", "hosting, OAuth and MCP Worker runtime", ["run", "test:worker-runtime"], 180_000, ["build", "database"]),
  npm("worker-dry-run", "API Worker dry run", workspace("factorize", "exec").concat(["--", "wrangler", "deploy", "--dry-run"]), 90_000, ["build"]),
  npm("tail-dry-run", "tail relay Worker dry run", workspace("factorize-tail-relay", "exec").concat(["--", "wrangler", "deploy", "--dry-run"])),
  npm("conditions", "webhook conditions in workerd", ["run", "test:conditions-runtime"]),
];
const lanes = {
  all: [build, database, ...api, ...browser, ...worker, ...staticChecks],
  backend: [build, database, ...api, ...worker, ...staticChecks],
  api: [build, database, ...api],
  browser: [build, ...browser],
  worker: [build, database, ...worker],
  static: staticChecks,
  proxy: [
    database,
    staticChecks.find(({ id }) => id === "harness"),
    npm("proxy", "backend proxy protocol checks", [
      ...workspace("factorize", "test"), "--",
      "test/agent-api.postgres.test.ts", "test/proxy-results.postgres.test.ts",
    ], 90_000, ["database"]),
  ],
};

if (!Object.hasOwn(lanes, lane)) {
  console.error("Unknown validation lane. Use all, backend, api, browser, worker, static, or proxy.");
  process.exit(2);
}

if (process.version !== "v" + expectedNode) {
  console.error(`Node ${expectedNode} is required; found ${process.version}. Use the validation runner image or the pinned Node version.`);
  process.exit(1);
}

if (["all", "backend", "api", "worker", "proxy"].includes(lane) && !process.env.AUTH_TEST_DATABASE_URL) {
  console.error("Database validation requires AUTH_TEST_DATABASE_URL for an isolated, migrated PostgreSQL database. Run npm run bootstrap:test.");
  process.exit(1);
}

const concurrency = Number(process.env.FACTORIZE_VALIDATION_JOBS ?? Math.min(availableParallelism(), 4));
if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("FACTORIZE_VALIDATION_JOBS must be a positive integer.");

const cancellation = new AbortController();
let receivedSignal;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    receivedSignal = signal;
    cancellation.abort(signal);
  });
}
const suiteDeadline = setTimeout(() => cancellation.abort("timeout"), 1_000_000);

const run = async ({ name, command, args, timeout }) => {
  console.log(`\n▶ ${name}`);
  const output = [];
  const result = await runProcess(command, args, {
    timeoutMs: timeout,
    signal: cancellation.signal,
    onOutput: (_stream, chunk) => output.push(chunk),
  });
  if (output.length) process.stdout.write(Buffer.concat(output));
  if (result.timedOut) console.error(`${name}: exceeded its ${timeout}ms deadline; process stopped.`);
  else if (result.aborted) console.error(`${name}: interrupted by ${result.signal}.`);
  else if (result.error) console.error(`${name}: ${result.error.message}`);
  if (result.code !== 0) console.error(`${name}: exited with status ${result.code}.`);
  return result.code;
};

let results;
const steps = lanes[lane];
try {
  results = await scheduleValidation(steps, { run, concurrency, signal: cancellation.signal });
} finally {
  clearTimeout(suiteDeadline);
}

console.log("\n=== validation summary ===");
for (const [index, { status, seconds }] of results.entries()) {
  console.log(`${status.padEnd(8)} ${steps[index].name}${seconds === undefined ? "" : ` (${seconds.toFixed(2)}s)`}`);
}
if (receivedSignal) process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 })[receivedSignal]);
if (cancellation.signal.aborted || results.some(({ status }) => status !== "passed")) process.exit(1);
