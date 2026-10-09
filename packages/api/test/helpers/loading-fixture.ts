import { readFile, readdir } from "node:fs/promises";
import { Database } from "../../src/postgres/database";
import { IdentityRepository } from "../../src/postgres/identity-repository";
import { ConnectionRepository } from "../../src/postgres/connection-repository";
import { signSession } from "../../src/index";
import { encrypt } from "../../src/crypto";
import worker from "../../src/worker";
import type { Env, OAuthProps } from "../../src/types";

export async function loadingFixture(url: string) {
  let admin!: Database, db!: Database, env!: Env, auth!: OAuthProps, cookie!: string;
  const name = `loading_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const tenantId = crypto.randomUUID(), userId = crypto.randomUUID(), otherTenant = crypto.randomUUID();
  const jobIds = Array.from({ length: 10 }, () => crypto.randomUUID());
  const runId = crypto.randomUUID();
  async function setup() {
    admin = new Database({ connectionString: url });
    await admin.pool.query(`CREATE DATABASE ${name}`);
    const address = new URL(url!); address.pathname = `/${name}`;
    db = new Database({ connectionString: address.toString() });
    const dir = new URL("../../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) await db.pool.query(await readFile(new URL(file, dir), "utf8"));
    env = { ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path !== "/index.html" && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) return new Response("Not found", { status: 404 });
      try { return new Response(request.method === "HEAD" ? null : await readFile(new URL("../../../app/dist" + path, import.meta.url)), { headers: { "Content-Type": path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "text/html" } }); }
      catch { return new Response("Not found", { status: 404 }); }
    } } as unknown as Fetcher, DATABASE: db, APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "local-test-signing", OAUTH_PROVIDER: { listUserGrants: async () => ({ items: [] }) } as any, CREDENTIAL_ENCRYPTION_KEY: btoa("a".repeat(32)) } as Env;
    await new IdentityRepository(db, tenantId).upsertOwner(userId, "owner@example.test");
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [otherTenant]);
    auth = { tenantId, userId, sessionVersion: 0, scopes: ["flows:read", "flows:write", "runs:read", "runs:write"], authMethod: "session" };
    const member = await new IdentityRepository(db, tenantId).member(userId); auth.sessionVersion = member!.sessionVersion;
    cookie = `factorize_session=${await signSession({ ...auth, email: "owner@example.test", exp: Math.floor(Date.now()/1000)+3600 }, env.SESSION_SIGNING_SECRET)}`;
    const prompt = await encrypt("Prompt", env.CREDENTIAL_ENCRYPTION_KEY);
    for (const [i, id] of jobIds.entries()) {
      await db.pool.query("INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit) VALUES ($1,$2,$3,$3,$4,$5,2)", [tenantId, id, `Job-${i}`, prompt, { agentKind: "codex", connectionId: "local" }]);
      for (const [position, kind] of ["manual", "schedule"].entries()) await db.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug,position,config) VALUES ($1,$2,$3,$4,$4,$5,$6)", [tenantId, crypto.randomUUID(), id, kind, position, kind === "schedule" ? { cron: "0 * * * *", timezone: "UTC" } : {}]);
    }
    // Same job ID in another tenant must never contribute triggers or statistics.
    await db.pool.query("INSERT INTO app.jobs(tenant_id,id,name,slug,encrypted_prompt_template,execution_target,concurrency_limit) VALUES ($1,$2,'Private','private',$3,'{}',1)", [otherTenant, jobIds[0], prompt]);
    await db.pool.query("INSERT INTO app.triggers(tenant_id,id,job_id,kind,slug) VALUES ($1,$2,$3,'manual','private')", [otherTenant, crypto.randomUUID(), jobIds[0]]);
    for (const [i, state] of ["running", "succeeded", "queued"].entries()) {
      const id = i === 2 ? runId : crypto.randomUUID(), invocationId = crypto.randomUUID();
      await db.pool.query("INSERT INTO app.invocations(tenant_id,id,job_id,source,claim_key,context,trigger_id) VALUES ($1,$2,$3,'manual',$4,'{}',(SELECT id FROM app.triggers WHERE tenant_id=$1 AND job_id=$3 AND kind='manual'))", [tenantId, invocationId, jobIds[0], `test-${i}`]);
      await db.pool.query("INSERT INTO app.job_runs(tenant_id,id,job_id,invocation_id,state,encrypted_prompt,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [tenantId, id, jobIds[0], invocationId, state, prompt, new Date(1000+i*1000)]);
      await db.pool.query("INSERT INTO app.runs(tenant_id,id,job_id,invocation_id,provider,issue_id,agent_kind,state,execution_backend_kind,agent_name) VALUES ($1,$2,$3,$4,'manual',$5,'codex',$6,'exe-vm','')", [tenantId, id, jobIds[0], invocationId, `test-${i}`, state]);
    }
    const connections = new ConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
    await connections.put("exe:local", { apiToken: "private-exe-token", agentKind: "codex", models: [] });
    await connections.put("amp:local", { accessToken: "private-amp-token", project: "project" });
    await connections.put("cloudflare-tail:local", { signingSecret: "private-tail-secret", name: "Local" });
  }
  async function cleanup() { await db?.close(); if (admin) { await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.close(); } }
  const request = (path: string, value = cookie) => worker.fetch(new Request(`https://factorize.test${path}`, { headers: { Cookie: value } }), env, { waitUntil() {} } as any);

  try { await setup(); } catch (error) { await cleanup(); throw error; }
  return { db, env, auth, cookie, jobIds, runId, tenantId, userId, otherTenant, request, cleanup };
}
