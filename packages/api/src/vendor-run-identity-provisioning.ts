import type { Database } from "./postgres/database";
import { VendorRunIdentityRepository } from "./postgres/vendor-run-identity-repository";
import { discoverVendorIssuerTrust, verifyVendorRunIdentity, type VendorIdentityProvider } from "./vendor-run-identity";

function issuerFromToken(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) throw new Error();
    const claims = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))) as { iss?: unknown };
    if (typeof claims.iss !== "string") throw new Error();
    return claims.iss;
  } catch {
    throw new Error("Vendor identity token has no valid issuer");
  }
}

/** Verify a provider token against the provisioned machine and durably bind it
 * to the active run. Only claim metadata is persisted; the JWT is discarded. */
export async function verifyAndPersistVendorRunIdentity(input: {
  database: Database;
  tenantId: string;
  runId: string;
  provider: VendorIdentityProvider;
  vmId: string;
  token: string;
  audience: string;
  integrationName?: string;
  expectedIssuer?: string;
  expectedSubject?: string;
  now?: Date;
}) {
  const repository = new VendorRunIdentityRepository(input.database);
  const now = input.now ?? new Date();
  const prior = await repository.getActive({ tenantId: input.tenantId, runId: input.runId, provider: input.provider, now });
  const issuer = issuerFromToken(input.token);
  if (input.expectedIssuer && issuer !== input.expectedIssuer) throw new Error("Vendor identity issuer mismatch");
  const trust = await discoverVendorIssuerTrust({ provider: input.provider, issuer });
  const identity = await verifyVendorRunIdentity({
    token: input.token,
    resolveKey: trust.resolveKey,
    nowSeconds: Math.floor(now.getTime() / 1000),
    binding: {
      provider: input.provider,
      runId: input.runId,
      activeRunId: input.runId,
      vmId: input.vmId,
      issuer: prior?.issuer ?? trust.issuer,
      audience: prior?.audience ?? input.audience,
      ...((prior?.subject ?? input.expectedSubject) ? { subject: prior?.subject ?? input.expectedSubject } : {}),
      ...(input.provider === "exe.dev" && input.integrationName ? {
        exeAttachment: { integrationName: input.integrationName, attachedVmId: input.vmId, mode: "vm" as const },
      } : {}),
    },
  });
  if (identity.audience !== input.audience) throw new Error("Vendor identity audience mismatch");
  return repository.persistVerified({ tenantId: input.tenantId, identity, issuedAt: identity.issuedAt, now });
}
