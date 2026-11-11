import type { ProxyControlRepository } from "./postgres/proxy-control-repository";

export type ProxyBootstrapProvisioning = {
  tenantId: string;
  proxyIdentity: string;
  /** A new UUID for every process boot. */
  bootEpoch: string;
  controlOrigin: string;
};

/**
 * Connects one-use bootstrap credential issuance to the infrastructure
 * provisioner's private control channel. Implementations must deliver the
 * credential directly to proxy stdin (or an equally short-lived memory-only
 * channel), never through Machine config, environment, metadata, disk, or logs.
 */
export async function provisionCredentialProxy(
  input: ProxyBootstrapProvisioning,
  dependencies: {
    control: Pick<ProxyControlRepository, "provisionCredential" | "revokeCredential">;
    startProxy: (request: ProxyBootstrapProvisioning & { credential: string }) => Promise<void>;
  },
): Promise<{ proxyIdentity: string; bootEpoch: string }> {
  const origin = new URL(input.controlOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new TypeError("controlOrigin must be an HTTPS origin");
  }
  const credential = await dependencies.control.provisionCredential(input.tenantId, input.proxyIdentity, input.bootEpoch);
  try {
    await dependencies.startProxy({ ...input, controlOrigin: origin.origin, credential });
  } catch (error) {
    // A failed/ambiguous start must not leave a valid bootstrap credential.
    await dependencies.control.revokeCredential(input.tenantId, input.proxyIdentity).catch(() => false);
    throw error;
  }
  return { proxyIdentity: input.proxyIdentity, bootEpoch: input.bootEpoch };
}
