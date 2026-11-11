import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const exec = promisify(execFile);
const runTests = process.argv.includes("--test");
const expectedNode = "v24.12.0";
const expectedNpm = "11.19.0";
const databaseUrl = process.env.VALIDATION_DATABASE_URL ?? "postgresql://postgres:local-validation-only@localhost:5432/factorize_validation";
const adminUrl = process.env.VALIDATION_DATABASE_ADMIN_URL ?? "postgresql://postgres:local-validation-only@localhost:5432/postgres";
const url = new URL(databaseUrl);
const admin = new URL(adminUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !["localhost", "127.0.0.1"].includes(admin.hostname)) {
  throw new Error("Validation databases must be local PostgreSQL instances; production or remote database URLs are refused.");
}
if (process.version !== expectedNode) throw new Error(`Validation requires Node ${expectedNode}; found ${process.version}. Boot the pinned Factorize validation runner image.`);
const npmVersion = (await exec("npm", ["--version"])).stdout.trim();
if (npmVersion !== expectedNpm) throw new Error(`Validation requires npm ${expectedNpm}; found ${npmVersion}. Boot the pinned Factorize validation runner image.`);

function runInherited(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

await exec(process.platform === "win32" ? "where" : "which", ["psql"]);
try {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  await browser.close();
} catch (error) {
  throw new Error("Validation Chromium is unavailable before database reset. Boot the pinned Factorize validation runner image and preserve PLAYWRIGHT_BROWSERS_PATH from its image environment.", { cause: error });
}
await exec("psql", [admin.href, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${url.pathname.slice(1)}' AND pid <> pg_backend_pid();`]);
await exec("psql", [admin.href, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS \"${url.pathname.slice(1)}\";`]);
await exec("psql", [admin.href, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE \"${url.pathname.slice(1)}\";`]);
const env = { ...process.env, DATABASE_URL: databaseUrl, AUTH_TEST_DATABASE_URL: databaseUrl, QUEUE_TEST_DATABASE_URL: databaseUrl };
await exec("npm", ["run", "db:migrate", "--workspace=factorize"], { env, stdio: "inherit" });
console.log(`Isolated validation database ready: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
if (runTests) {
  await runInherited("npm", ["test"], { env });
} else {
console.log(`export DATABASE_URL=${JSON.stringify(databaseUrl)}`);
console.log(`export AUTH_TEST_DATABASE_URL=${JSON.stringify(databaseUrl)}`);
console.log(`export QUEUE_TEST_DATABASE_URL=${JSON.stringify(databaseUrl)}`);
console.log("Then run: npm test");
}
