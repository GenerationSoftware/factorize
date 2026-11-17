import { describe, expect, it, vi } from "vitest";
import { acquireExeDevWifToken, acquireFlyMachineOidcToken, renewExeDevWifToken, renewFlyMachineOidcToken } from "../src/vendor-run-token-sources";

const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl";

describe("vendor run identity token sources", () => {
  it("requests an exe.dev WIF token from the exact integration host and supports renewal", async () => {
    const fetcher = vi.fn(async () => Response.json({ token }));
    await expect(acquireExeDevWifToken({ integrationName: "factorize-run-123", fetcher })).resolves.toBe(token);
    await expect(renewExeDevWifToken({ integrationName: "factorize-run-123", fetcher })).resolves.toBe(token);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("https://factorize-run-123.int.exe.xyz/token", expect.objectContaining({ headers: { accept: "application/json" } }));
  });

  it("requests Fly OIDC with the configured audience over the Machine API socket and supports renewal", async () => {
    const run = vi.fn(async () => ({ ok: true, exitCode: 0, stdout: token, stderr: "" }));
    const guest = { run };
    await expect(acquireFlyMachineOidcToken({ guest, audience: "https://factorize.example/vendor-run" })).resolves.toBe(token);
    await expect(renewFlyMachineOidcToken({ guest, audience: "https://factorize.example/vendor-run" })).resolves.toBe(token);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith([
      "curl", "--fail", "--silent", "--show-error", "--max-time", "10", "--unix-socket", "/.fly/api", "-X", "POST",
      "-H", "Content-Type: application/json", "--data", JSON.stringify({ aud: "https://factorize.example/vendor-run" }),
      "http://localhost/v1/tokens/oidc",
    ]);
  });

  it("rejects invalid provider configuration and malformed or failed responses", async () => {
    await expect(acquireExeDevWifToken({ integrationName: "not a host" })).rejects.toThrow("integration name");
    await expect(acquireFlyMachineOidcToken({ guest: { run: vi.fn() }, audience: " " })).rejects.toThrow("audience");
    await expect(acquireExeDevWifToken({ integrationName: "wif", fetcher: async () => Response.json({ token: "not-a-jwt" }) })).rejects.toThrow("invalid token");
    await expect(acquireExeDevWifToken({ integrationName: "wif", fetcher: async () => new Response("", { status: 403 }) })).rejects.toThrow("(403)");
    await expect(acquireFlyMachineOidcToken({ guest: { run: async () => ({ ok: false, exitCode: 22, stdout: "", stderr: "not logged" }) }, audience: "factorize" })).rejects.toThrow("request failed");
  });
});
