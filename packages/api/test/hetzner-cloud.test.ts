import { describe, expect, it, vi } from "vitest";
import { createHetznerCloudClient } from "../src/integrations/providers/hetzner-cloud";

const token = "syntheticTokenNeverReturned";
const remoteServer = { id: 41, name: "example", status: "running", location: { id: 1, name: "fsn1" },
  public_net: { ipv4: { ip: "192.0.2.110" } }, labels: { token } };
const pageResponse = (next_page: number | null) => Response.json({ servers: [remoteServer], meta: { pagination: { next_page } } });

describe("fixed Hetzner Cloud inventory client", () => {
  it("uses a bounded sequence on the fixed HTTPS endpoint and strips unneeded properties", async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      return pageResponse(Number(url.searchParams.get("page")) + 1);
    });
    const result = await createHetznerCloudClient(fetcher).inventory(token);
    expect(result.truncated).toBe(true);
    expect(result.servers).toEqual(Array(4).fill({ id: 41, name: "example", status: "running", location: "fsn1" }));
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([1, 2, 3, 4].map(page =>
      `https://api.hetzner.cloud/v1/servers?page=${page}&per_page=25`));
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}` } });
      expect(options?.signal).toBe(signal);
    }
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("returns a complete empty snapshot and validates a replacement with just one GET", async () => {
    const first = vi.fn<typeof fetch>(async () => Response.json({ servers: [], meta: { pagination: { next_page: null } } }));
    await expect(createHetznerCloudClient(first).inventory(token)).resolves.toEqual({ servers: [], truncated: false });
    expect(first).toHaveBeenCalledTimes(1);
    const hasMore = vi.fn<typeof fetch>(async () => pageResponse(2));
    await createHetznerCloudClient(hasMore).validate(token);
    expect(hasMore).toHaveBeenCalledTimes(1);
  });

  it("does not relay upstream errors, suspicious pagination, or oversized bodies", async () => {
    const cases: Array<[() => Promise<Response>, string]> = [
      [async () => new Response(token, { status: 403 }), "auth"],
      [async () => new Response(token, { status: 429 }), "unavailable"],
      [async () => { throw new Error(token); }, "unavailable"],
      [async () => pageResponse(1), "invalid_response"],
      [async () => new Response(token, { headers: { "content-length": "10000000" } }), "invalid_response"],
      [async () => new Response(token.repeat(30_000)), "invalid_response"],
    ];
    for (const [reply, kind] of cases) {
      const result = await createHetznerCloudClient(reply).inventory(token).catch(error => error);
      expect(result).toMatchObject({ kind });
      expect(String(result)).not.toContain(token);
    }
  });

  it("categorizes timeout, transport, and upstream status without preserving raw errors", async () => {
    const timeout = new AbortController();
    timeout.abort();
    const clock = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeout.signal);
    try {
      await expect(createHetznerCloudClient(async () => { throw new Error(token); }).validate(token))
        .rejects.toMatchObject({ kind: "unavailable", reason: "timeout" });
    } finally { clock.mockRestore(); }
    await expect(createHetznerCloudClient(async () => { throw new Error(token); }).validate(token))
      .rejects.toMatchObject({ reason: "transport_error" });
    await expect(createHetznerCloudClient(async () => new Response(token, { status: 503 })).validate(token))
      .rejects.toMatchObject({ reason: "upstream_error", upstreamStatus: 503 });
  });

  it("only resolves a numeric server in the connected project and verifies the response identity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ server: remoteServer }));
    const client = createHetznerCloudClient(fetcher);
    await expect(client.target(token, 41)).resolves.toEqual({ id: 41, ipv4: "192.0.2.110" });
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.hetzner.cloud/v1/servers/41");
    await expect(client.target(token, NaN)).rejects.toMatchObject({ kind: "not_found" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(client.target(token, 42)).rejects.toMatchObject({ kind: "invalid_response" });
  });
});
