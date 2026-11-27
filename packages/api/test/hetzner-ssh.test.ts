import { expect, it, vi } from "vitest";
import { hetznerSshEnrollment, hetznerSshToolInput } from "../src/integrations/api/hetzner-ssh-contracts";
import { freshHetznerProbe } from "../src/integrations/application/hetzner-ssh-probe";
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

it("revalidates provider ownership and the exact address for every check; never dials on drift", async () => {
  const lookup = vi.fn(async () => ({ ipv4: "8.8.4.4" }));
  const authenticate = vi.fn(async () => {});
  const input = { enrolledAddress: "8.8.4.4", lookup, active: async () => true, authenticate };
  expect(await freshHetznerProbe(input)).toBe(true);
  expect(await freshHetznerProbe(input)).toBe(true);
  expect(lookup).toHaveBeenCalledTimes(2);
  lookup.mockResolvedValueOnce({ ipv4: "8.8.8.8" }).mockRejectedValueOnce(new Error("provider authorization lost"));
  expect(await freshHetznerProbe(input)).toBe(false);
  await expect(freshHetznerProbe(input)).rejects.toThrow("provider authorization lost");
  expect(authenticate).toHaveBeenCalledTimes(2);
});

it("aborts a pending handshake after local key or grant revocation", async () => {
  vi.useFakeTimers();
  try {
    let allowed = true, begin!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; });
    const pending = freshHetznerProbe({
      enrolledAddress: "8.8.4.4", lookup: async () => ({ ipv4: "8.8.4.4" }), active: async () => allowed,
      authenticate: signal => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("check closed")), { once: true }); begin();
      }),
    });
    const closed = expect(pending).rejects.toThrow("check closed");
    await started;
    allowed = false;
    await vi.advanceTimersByTimeAsync(1000);
    await closed;
  } finally { vi.useRealTimers(); }
});
