import { describe, expect, it, vi } from "vitest";
import { provisionCredentialProxy } from "../src/proxy-provisioner";

const input = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  proxyIdentity: "fly-app/proxy-machine",
  bootEpoch: "22222222-2222-4222-8222-222222222222",
  controlOrigin: "https://factorize.example/",
};

describe("credential proxy bootstrap provisioning", () => {
  it("issues an epoch-bound credential only to the provisioner's private start channel", async () => {
    const control = {
      provisionCredential: vi.fn().mockResolvedValue("fzc_one-use-secret"),
      revokeCredential: vi.fn().mockResolvedValue(true),
    };
    const startProxy = vi.fn().mockResolvedValue(undefined);

    await expect(provisionCredentialProxy(input, { control, startProxy })).resolves.toEqual({
      proxyIdentity: input.proxyIdentity,
      bootEpoch: input.bootEpoch,
    });

    expect(control.provisionCredential).toHaveBeenCalledWith(input.tenantId, input.proxyIdentity, input.bootEpoch);
    expect(startProxy).toHaveBeenCalledWith({ ...input, controlOrigin: "https://factorize.example", credential: "fzc_one-use-secret" });
    expect(control.revokeCredential).not.toHaveBeenCalled();
  });

  it("revokes the one-use credential if proxy startup fails", async () => {
    const control = {
      provisionCredential: vi.fn().mockResolvedValue("fzc_one-use-secret"),
      revokeCredential: vi.fn().mockResolvedValue(true),
    };
    const failure = new Error("startup failed");
    await expect(provisionCredentialProxy(input, { control, startProxy: vi.fn().mockRejectedValue(failure) })).rejects.toBe(failure);
    expect(control.revokeCredential).toHaveBeenCalledWith(input.tenantId, input.proxyIdentity);
  });

  it("rejects non-HTTPS or non-origin control URLs before issuing a credential", async () => {
    const control = { provisionCredential: vi.fn(), revokeCredential: vi.fn() };
    await expect(provisionCredentialProxy({ ...input, controlOrigin: "http://factorize.example" }, { control, startProxy: vi.fn() })).rejects.toThrow("HTTPS origin");
    await expect(provisionCredentialProxy({ ...input, controlOrigin: "https://factorize.example/path" }, { control, startProxy: vi.fn() })).rejects.toThrow("HTTPS origin");
    expect(control.provisionCredential).not.toHaveBeenCalled();
  });
});
