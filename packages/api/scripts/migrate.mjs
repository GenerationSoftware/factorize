import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = (await readdir(migrationsDirectory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
const client = new pg.Client({ connectionString: databaseUrl, ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('factorize:migrations'))");
  await client.query("CREATE SCHEMA IF NOT EXISTS app");
  await client.query("CREATE TABLE IF NOT EXISTS app.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await client.query("SELECT version FROM app.schema_migrations")).rows.map(({ version }) => version));
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO app.schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [version]);
      await client.query("COMMIT");
      console.log(`applied ${version}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('factorize:migrations'))").catch(() => undefined);
  await client.end();
}
