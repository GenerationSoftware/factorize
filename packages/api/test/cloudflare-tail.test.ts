import { describe, expect, it } from "vitest";
import { generateTailSecret, sanitizeTailEvent, signTailDelivery, suppressTailEvent, tailFingerprint, verifyTailDelivery } from "../src/cloudflare-tail";

describe("Cloudflare Tail ingestion", () => {
  it("generates independent strong URL-safe installation secrets", () => {
    const first = generateTailSecret(), second = generateTailSecret();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });
  it("signs the timestamp, delivery ID, and exact body and rejects tampering or stale requests", async () => {
    const body = JSON.stringify({ outcome: "exception" }), timestamp = String(Date.now()), delivery = "delivery-1", secret = "s".repeat(43);
    const signature = await signTailDelivery(secret, timestamp, delivery, body);
    await expect(verifyTailDelivery(secret, timestamp, delivery, body, `sha256=${signature}`)).resolves.toBe("valid");
    await expect(verifyTailDelivery(secret, timestamp, delivery, `${body} `, signature)).resolves.toBe("invalid");
    await expect(verifyTailDelivery(secret, String(Date.now() - 61_000), delivery, body, signature)).resolves.toBe("stale");
  });

  it("removes sensitive data recursively before handlers, activity, or prompts", () => {
    const event = sanitizeTailEvent({ scriptName: "producer", event: { request: { headers: { authorization: "Bearer x", cookie: "x=y", accept: "json" }, body: "raw" } }, token: "secret", logs: [{ level: "error", message: "safe" }] });
    expect(JSON.stringify(event)).not.toContain("Bearer x");
    expect(JSON.stringify(event)).not.toContain("x=y");
    expect(JSON.stringify(event)).not.toContain("raw");
    expect(event.event.request.headers.accept).toBe("json");
  });

  it("suppresses relay and ingestion failures and fingerprints repeats", async () => {
    expect(suppressTailEvent({ scriptName: "factorize-tail-relay" })).toBe(true);
    expect(suppressTailEvent({ logs: [{ message: "factorize_tail_ingestion failed" }] })).toBe(true);
    expect(await tailFingerprint({ scriptName: "a", outcome: "exception" })).toBe(await tailFingerprint({ scriptName: "a", outcome: "exception" }));
    expect(await tailFingerprint({ scriptName: "a" })).not.toBe(await tailFingerprint({ scriptName: "b" }));
  });
});
