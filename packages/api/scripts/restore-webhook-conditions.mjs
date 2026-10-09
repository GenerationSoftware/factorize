// Explicit post-deploy step. A failed release leaves affected triggers disabled.
import pg from "pg";
import { restoreConditionsCutover } from "./webhook-conditions-cutover.mjs";
const origin = process.argv[2];
if (!origin || !process.env.DATABASE_URL) throw new Error("Origin and DATABASE_URL are required");
// The OAuth envelope protects unknown routes before dispatch, so anonymous
// route status alone cannot distinguish old/new Workers. Use the public marker.
let ready = false;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(new URL("/api/v1/session", origin), { redirect: "manual", cache: "no-store" });
  if (response.status === 200 && response.headers.get("x-factorize-webhook-conditions") === "v1") { ready = true; break; }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!ready) throw new Error("Conditions API cutover is not live; affected triggers stay disabled");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false } });
await client.connect();
try {
  console.log(JSON.stringify({ restored: await restoreConditionsCutover(client) }));
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { await client.end(); }
