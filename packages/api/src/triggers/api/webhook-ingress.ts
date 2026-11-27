import { equalHmac } from "../../crypto";
import { databaseFor } from "../../postgres/database";
import { GitHubRepository } from "../../credentials/storage/github-repository";
import { WebhookService } from "../application/webhook-service";
import type { BrowserRouter } from "../../runtime/browser-router";

export function mountWebhookIngress(app: BrowserRouter) {
  // Keep the old address as a tombstone so relays receive a permanent response.
  app.post("/webhooks/cloudflare/:tenantId/:triggerId", c => c.text("Cloudflare Tail is retired", 410));

  app.post("/webhooks/linear", async (c) => {
    if (!c.env.LINEAR_WEBHOOK_SIGNING_SECRET) return c.text("Webhook verification is not configured", 503);
    const raw = await c.req.text();
    if (!(await equalHmac(raw, c.req.header("linear-signature") ?? "", c.env.LINEAR_WEBHOOK_SIGNING_SECRET))) return c.text("Invalid signature", 401);
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return c.text("Invalid JSON", 400); }
    const timestamp = Number(event.webhookTimestamp ?? c.req.header("linear-timestamp"));
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) return c.text("Stale webhook", 401);
    const organizationId = event.organizationId;
    if (typeof organizationId !== "string" || !organizationId) return c.text("Missing organization ID", 400);
    const deliveryId = c.req.header("linear-delivery");
    if (!deliveryId) return c.text("Missing delivery ID", 400);
    const binding = (await databaseFor(c.env).pool.query<{ tenant_id: string }>("SELECT w.tenant_id FROM app.linear_workspaces w JOIN app.connections c ON c.tenant_id=w.tenant_id AND c.kind='linear' WHERE w.organization_id=$1", [organizationId])).rows[0];
    if (binding) await new WebhookService(databaseFor(c.env), c.env, binding.tenant_id).linear(event, `linear:${deliveryId}`);
    return c.body(null, 200);
  });

  app.post("/webhooks/clickup/:tenantId", async (c) => {
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > 262_144) return c.text("Payload too large", 413);
    try { JSON.parse(raw); } catch { return c.text("Invalid JSON", 400); }
    try { await new WebhookService(databaseFor(c.env), c.env, c.req.param("tenantId")).clickup(raw, c.req.header("X-Signature") ?? ""); return c.body(null, 200); } catch { return c.text("Invalid signature", 401); }
  });

  app.post("/webhooks/github", async (c) => {
    if (!c.env.GITHUB_WEBHOOK_SECRET) return c.text("Webhook verification is not configured", 503);
    const raw = await c.req.text();
    const signature = c.req.header("X-Hub-Signature-256") ?? "";
    if (!signature.startsWith("sha256=") || !(await equalHmac(raw, signature.slice(7), c.env.GITHUB_WEBHOOK_SECRET))) return c.text("Invalid signature", 401);
    const delivery = c.req.header("X-GitHub-Delivery"), eventName = c.req.header("X-GitHub-Event");
    if (!delivery || !eventName) return c.text("Missing GitHub headers", 400);
    let event: any; try { event = JSON.parse(raw); } catch { return c.text("Invalid JSON", 400); }
    const installationId = event.installation?.id;
    if (!Number.isSafeInteger(installationId)) return c.text("Missing installation ID", 400);
    const registration = await GitHubRepository.locate(databaseFor(c.env), installationId);
    if (!registration) { console.info(JSON.stringify({ event: "github_webhook_unrouted", installationId, delivery, eventName })); return c.body(null, 202); }
    if (eventName === "installation" && ["deleted", "suspend", "unsuspend"].includes(event.action)) {
      const state: "active" | "suspended" = event.action === "unsuspend" ? "active" : "suspended";
      const repository = new GitHubRepository(databaseFor(c.env), registration.tenant_id);
      if (event.action === "deleted") await repository.delete(installationId); else await repository.updateState(installationId, state);
      return c.body(null, 202);
    }
    if (registration.state !== "active") return c.body(null, 202);
    await new WebhookService(databaseFor(c.env), c.env, registration.tenant_id).github(event, `github:${delivery}`, eventName); return c.body(null, 202);
  });
}
