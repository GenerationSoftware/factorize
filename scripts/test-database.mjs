import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import pg from "pg";

function parseTemplate(templateUrl) {
  const url = new URL(templateUrl);
  const template = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !["postgres:", "postgresql:"].includes(url.protocol) || !/^[a-z_][a-z0-9_]*$/.test(template) ||
      ["postgres", "template0", "template1"].includes(template) || url.search || url.hash) {
    throw new Error("Database fixtures require a migrated, disposable loopback PostgreSQL database.");
  }

  return { url, template };
}

export async function verifyTestDatabase(templateUrl) {
  const { url } = parseTemplate(templateUrl);
  const db = new pg.Client({ connectionString: url.href });
  const files = await readdir(new URL("../packages/api/migrations/", import.meta.url));
  const expected = files.filter(file => /^\d+.*\.sql$/.test(file)).map(file => file.slice(0, -4)).sort();
  try {
    await db.connect();
    const { rows } = await db.query("SELECT version FROM app.schema_migrations");
    const applied = rows.map(row => row.version).sort();
    if (JSON.stringify(applied) !== JSON.stringify(expected)) throw new Error("Migration history differs from this checkout.");
  } catch (error) {
    throw new Error("Prepare the isolated test template with npm run bootstrap:test before validation.", { cause: error });
  } finally {
    await db.end();
  }
}

export async function cloneTestDatabase(templateUrl) {
  const { url, template } = parseTemplate(templateUrl);
  const name = "factorize_test_" + randomUUID().replaceAll("-", "");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.href });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name} TEMPLATE "${template}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }

  url.pathname = "/" + name;
  return {
    url: url.href,
    async close() {
      try {
        await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}
