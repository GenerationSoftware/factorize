import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import https from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { apiWranglerCli } from "./api-wrangler.mjs";
import { cloneTestDatabase } from "./test-database.mjs";
import { checkHosting } from "./hosting-runtime.mjs";
import { checkOAuth } from "./oauth-runtime.mjs";

const appOrigin = "https://factorize.test";
const secret = randomBytes(32).toString("hex");
let database, db, directory, worker, transportOrigin;

function stream(path, method = "GET", body, headers = {}, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(transportOrigin + path, {
      method, headers, signal, rejectUnauthorized: false,
    }, resolve);
    request.setTimeout(15_000, () => request.destroy(new Error(`Worker request timed out: ${path}`)));
    request.on("error", reject);
    request.end(body);
  });
}

async function read(path, method, body, headers) {
  const response = await stream(path, method, body, headers);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  let json;
  if (response.headers["content-type"]?.includes("application/json")) json = JSON.parse(text);
  return { status: response.statusCode, headers: response.headers, body: text, text, json };
}

async function owner(label) {
  const tenantId = randomUUID(), userId = randomUUID(), email = `${label}@fixture.test`;
  await db.query("INSERT INTO app.tenants(id,name) VALUES ($1,$2)", [tenantId, label]);
  await db.query("INSERT INTO app.auth_users(id,email,email_verified) VALUES ($1,$2,true)", [userId, email]);
  await db.query("INSERT INTO app.members(tenant_id,user_id,email,role,session_version) VALUES ($1,$2,$3,'owner',1)", [tenantId, userId, email]);
  const session = Buffer.from(JSON.stringify({ tenantId, userId, email, sessionVersion: 1, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(session).digest("base64");
  return { appOrigin, db, read, stream, tenantId, userId, cookie: "factorize_session=" + encodeURIComponent(session + "." + signature) };
}

describe("local Cloudflare Worker", { concurrency: 2 }, () => {
  before(async () => {
    assert.ok(process.env.AUTH_TEST_DATABASE_URL, "Run npm run bootstrap:test to prepare the disposable database.");
    database = await cloneTestDatabase(process.env.AUTH_TEST_DATABASE_URL);
    db = new pg.Client({ connectionString: database.url });
    await db.connect();
    directory = await mkdtemp(join(tmpdir(), "factorize-runtime-"));
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const { port } = socket.address();
    await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    transportOrigin = `https://localhost:${port}`;
    worker = spawn(process.execPath, [
      apiWranglerCli, "dev", "--local", "--local-protocol", "https", "--local-upstream", "factorize.test",
      "--port", String(port), "--persist-to", directory, "--var", `APP_ORIGIN:${appOrigin}`,
      "--var", `SESSION_SIGNING_SECRET:${secret}`, "--var", `CREDENTIAL_ENCRYPTION_KEY:${randomBytes(32).toString("base64")}`,
    ], {
      cwd: fileURLToPath(new URL("../packages/api/", import.meta.url)),
      env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database.url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Local Worker did not start: " + output)), 30_000);
      const collect = chunk => {
        output += chunk.toString();
        if (output.includes("Ready on")) { clearTimeout(timeout); resolve(); }
      };
      worker.stdout.on("data", collect);
      worker.stderr.on("data", collect);
      worker.once("error", error => { clearTimeout(timeout); reject(error); });
      worker.once("exit", code => { clearTimeout(timeout); reject(new Error(`Local Worker exited ${code}: ${output}`)); });
    });
  });

  after(async () => {
    try {
      if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
        const exited = once(worker, "exit");
        worker.kill();
        await exited;
      }
    } finally {
      try {
        await db?.end();
      } finally {
        try { await database?.close(); }
        finally { if (directory) await rm(directory, { recursive: true, force: true }); }
      }
    }
  });

  test("hosting enforces static/API/protocol ownership, headers, caching and Git Artifacts", { timeout: 60_000 }, async () => {
    await checkHosting(await owner("hosting"));
  });

  test("OAuth consent, device grants and MCP Event delivery", { timeout: 90_000 }, async () => {
    await checkOAuth(await owner("oauth"));
  });
});
