import { describe, expect, it } from "vitest";
import { requestCookie, readSession, signSession } from "../src/index";

describe("signed sessions", () => {
  it("round-trips and decodes URL-encoded cookie values", async () => {
    const session = { tenantId: crypto.randomUUID(), userId: crypto.randomUUID(), email: "owner@example.com", exp: Math.floor(Date.now() / 1000) + 60, sessionVersion: 1 };
    const value = await signSession(session, "secret"), request = new Request("https://factorize.test/", { headers: { cookie: `factorize_session=${encodeURIComponent(value)}` } });
    expect(requestCookie(request, "factorize_session")).toBe(value);
    expect(await readSession(value, "secret")).toEqual(session);
  });
});
