import { expect, it, vi } from "vitest";
import { hetznerSshEnrollment, hetznerSshToolInput } from "../src/integrations/api/hetzner-ssh-contracts";
import { HetznerSshPool } from "../src/integrations/application/hetzner-ssh-pool";
import { generateHetznerSshKey } from "../src/integrations/providers/hetzner-ssh-transport";

it("keeps user-supplied commands, hostnames, ports and extra fields out of the MCP tool", () => {
  for (const input of [{ serverId: 1, command: "probe" }, { serverId: 1, hostname: "another-host" }, { serverId: "1" }, { serverId: 0 }]) {
    expect(hetznerSshToolInput.safeParse(input).success).toBe(false);
  }
  expect(hetznerSshToolInput.parse({serverId: 1})).toEqual({serverId: 1});
  const input = {serverId: 1, username: "root", hostFingerprint: "SHA256:" + "A".repeat(43), clientInstallationId: crypto.randomUUID()};
  expect(hetznerSshEnrollment.safeParse(input).success).toBe(false);
  expect(hetznerSshEnrollment.safeParse({...input, username: "factorize-check", privateKey: "not-allowed"}).success).toBe(false);
});

it("generates an independent private key and only a corresponding SSH public key", () => {
  const first = generateHetznerSshKey(), next = generateHetznerSshKey();
  expect(first.publicKey).toMatch(/^ssh-ed25519 /);
  expect(first.privateKey).toMatch(/BEGIN OPENSSH PRIVATE KEY/);
  expect(next.publicKey).not.toBe(first.publicKey);
});

it("reuses for 30 seconds after a check and never replays a failed check", async () => {
  vi.useFakeTimers();
  const pool = new HetznerSshPool();
  try {
    const connection = { close: vi.fn(), check: vi.fn(async () => {}) };
    const dial = vi.fn(async () => connection);
    expect(await pool.check("host-a", dial)).toEqual({ reusedConnection: false });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await pool.check("host-a", dial)).toEqual({ reusedConnection: true });
    expect(dial).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(await pool.check("host-a", dial)).toEqual({ reusedConnection: false });
    connection.check.mockRejectedValueOnce(new Error("disconnected"));
    await expect(pool.check("host-a", dial)).rejects.toThrow("disconnected");
    expect(dial).toHaveBeenCalledTimes(2);
    expect(connection.close).toHaveBeenCalledTimes(2);
  } finally {
    pool.close();
    vi.useRealTimers();
  }
});

it("closes a warm transport when the enrollment changes and bounds concurrent checks", async () => {
  const pool = new HetznerSshPool();
  try {
    const first = { check: vi.fn(async () => {}), close: vi.fn() };
    await pool.check("old key", async () => first);
    let unblock!: () => void;
    const second = { check: () => new Promise<void>(r => { unblock = r; }), close: vi.fn() };
    const checking = pool.check("rotated key", async () => second);
    expect(await pool.check("rotated key", async () => second)).toEqual({ busy: true });
    unblock();
    expect(await checking).toEqual({ reusedConnection: false });
    expect(first.close).toHaveBeenCalledOnce();
  } finally { pool.close(); }
});
