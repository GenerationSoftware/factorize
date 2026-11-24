import { readFile, readdir } from "node:fs/promises";
import { Database } from "../../src/postgres/database";
import { IdentityRepository } from "../../src/postgres/identity-repository";
import { ConnectionRepository } from "../../src/postgres/connection-repository";
import { signSession } from "../../src/index";
import worker from "../../src/worker";
import type { Env, OAuthProps } from "../../src/types";

export async function loadingFixture(url: string) {
  let admin!: Database, db!: Database, env!: Env, auth!: OAuthProps, cookie!: string;
  let tearingDown = false;
  let unexpectedPoolError: Error | undefined;
  const name = `loading_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const tenantId = crypto.randomUUID(), userId = crypto.randomUUID(), otherTenant = crypto.randomUUID();
  const triggerIds = Array.from({ length: 10 }, () => crypto.randomUUID());
  async function setup() {
    admin = new Database({ connectionString: url });
    await admin.pool.query(`CREATE DATABASE ${name}`);
    const address = new URL(url!); address.pathname = `/${name}`;
    db = new Database({ connectionString: address.toString() });
    db.pool.on("error", error => {
      if (tearingDown && (error as NodeJS.ErrnoException).code === "57P01") return;
      unexpectedPoolError = error;
    });
    const dir = new URL("../../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) await db.pool.query(await readFile(new URL(file, dir), "utf8"));
    env = { ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path !== "/index.html" && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) return new Response("Not found", { status: 404 });
      try { return new Response(request.method === "HEAD" ? null : await readFile(new URL("../../../app/dist" + path, import.meta.url)), { headers: { "Content-Type": path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : path.endsWith(".ico") ? "image/x-icon" : "text/html" } }); }
      catch { return new Response("Not found", { status: 404 }); }
    } } as unknown as Fetcher, DATABASE: db, APP_ORIGIN: "https://factorize.test", SESSION_SIGNING_SECRET: "local-test-signing", OAUTH_PROVIDER: { listUserGrants: async () => ({ items: [] }) } as any, CREDENTIAL_ENCRYPTION_KEY: btoa("a".repeat(32)) } as Env;
    await new IdentityRepository(db, tenantId).upsertOwner(userId, "owner@example.test");
    await db.pool.query("INSERT INTO app.tenants(id) VALUES ($1)", [otherTenant]);
    auth = { tenantId, userId, sessionVersion: 0, scopes: ["team:read", "triggers:read", "integrations:read", "team:write", "triggers:write", "integrations:write"], authMethod: "session" };
    const member = await new IdentityRepository(db, tenantId).member(userId); auth.sessionVersion = member!.sessionVersion;
    cookie = `factorize_session=${await signSession({ ...auth, email: "owner@example.test", exp: Math.floor(Date.now()/1000)+3600 }, env.SESSION_SIGNING_SECRET)}`;
    for (const [i, id] of triggerIds.entries()) {
      const eventId = crypto.randomUUID();
      await db.pool.query("INSERT INTO app.event_definitions(tenant_id,id,name,current_revision) VALUES($1,$2,$3,1)", [tenantId,eventId,`trigger-${i}`]);
      await db.pool.query("INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema) VALUES($1,$2,1,'{\"type\":\"object\"}')", [tenantId,eventId]);
      await db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES ($1,$2,$3,$4,$4)", [tenantId,id,eventId,`Trigger-${i}`]);
      for (const [position, kind] of ["manual", "schedule"].entries()) await db.pool.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug,position,config) VALUES ($1,$2,$3,$4,$4,$5,$6)", [tenantId, crypto.randomUUID(), id, kind, position, kind === "schedule" ? { cron: "0 * * * *", timezone: "UTC" } : {}]);
    }
    // Same trigger ID in another tenant must never contribute events or statistics.
    const otherEventId = crypto.randomUUID();
    await db.pool.query("INSERT INTO app.event_definitions(tenant_id,id,name,current_revision) VALUES($1,$2,'private',1)", [otherTenant,otherEventId]);
    await db.pool.query("INSERT INTO app.event_definition_revisions(tenant_id,definition_id,revision,payload_schema) VALUES($1,$2,1,'{\"type\":\"object\"}')", [otherTenant,otherEventId]);
    await db.pool.query("INSERT INTO app.triggers(tenant_id,id,event_definition_id,name,slug) VALUES($1,$2,$3,'Private','private')", [otherTenant,triggerIds[0],otherEventId]);
    await db.pool.query("INSERT INTO app.events(tenant_id,id,trigger_id,kind,slug) VALUES ($1,$2,$3,'manual','private')", [otherTenant, crypto.randomUUID(), triggerIds[0]]);

    const connections = new ConnectionRepository(db, tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
    await connections.put("exe:local", { apiToken: "private-exe-token" });
    await connections.put("amp:local", { accessToken: "private-amp-token", project: "project" });
    await connections.put("cloudflare-tail:local", { signingSecret: "private-tail-secret", name: "Local" });
  }
  async function cleanup() {
    tearingDown = true;
    await db?.close();
    if (admin) {
      await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.close();
    }
    if (unexpectedPoolError) throw unexpectedPoolError;
  }
  const request = (path: string, value = cookie) => worker.fetch(new Request(`https://factorize.test${path}`, { headers: { Cookie: value } }), env, { waitUntil() {} } as any);

  try { await setup(); } catch (error) { await cleanup(); throw error; }
  return { db, env, auth, cookie, triggerIds, tenantId, userId, otherTenant, request, cleanup };
}
