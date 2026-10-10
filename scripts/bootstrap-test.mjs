import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const exec = promisify(execFile);
const databaseUrl = process.env.VALIDATION_DATABASE_URL ?? "postgresql://postgres:local-validation-only@localhost:5432/factorize_validation";
const adminUrl = process.env.VALIDATION_DATABASE_ADMIN_URL ?? "postgresql://postgres:local-validation-only@localhost:5432/postgres";
const url = new URL(databaseUrl);
const admin = new URL(adminUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !["localhost", "127.0.0.1"].includes(admin.hostname)) {
  throw new Error("Validation databases must be local PostgreSQL instances; production or remote database URLs are refused.");
}

await exec(process.platform === "win32" ? "where" : "which", ["psql"]);
await exec("psql", [admin.href, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${url.pathname.slice(1)}' AND pid <> pg_backend_pid();`]);
await exec("psql", [admin.href, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS \"${url.pathname.slice(1)}\";`]);
await exec("psql", [admin.href, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE \"${url.pathname.slice(1)}\";`]);
const env = { ...process.env, DATABASE_URL: databaseUrl, AUTH_TEST_DATABASE_URL: databaseUrl, QUEUE_TEST_DATABASE_URL: databaseUrl };
await exec("npm", ["run", "db:migrate", "--workspace=factorize"], { env, stdio: "inherit" });
console.log(`Isolated validation database ready: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
console.log(`export DATABASE_URL=${JSON.stringify(databaseUrl)}`);
console.log(`export AUTH_TEST_DATABASE_URL=${JSON.stringify(databaseUrl)}`);
console.log(`export QUEUE_TEST_DATABASE_URL=${JSON.stringify(databaseUrl)}`);
console.log("Then run: npm test");
