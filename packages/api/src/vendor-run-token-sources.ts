/** Documented provider token sources used by run-owned guests.
 *
 * These helpers only acquire a token. Callers must verify the signed claims
 * against the provisioned VM and active run before persisting or using it.
 */
import type { JobGuest } from "./machine-job-execution-backend";

const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function requireJwt(value: string): string {
  const token = value.trim();
  if (!jwt.test(token)) throw new Error("Vendor identity endpoint returned an invalid token");
  return token;
}

/** exe.dev documents the WIF integration's /token endpoint as returning
 * `{ token: "<short-lived OIDC JWT>" }` on its integration-only hostname. */
export async function acquireExeDevWifToken(input: {
  integrationName: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(input.integrationName)) throw new TypeError("Invalid exe.dev WIF integration name");
  const response = await (input.fetcher ?? fetch)(`https://${input.integrationName}.int.exe.xyz/token`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`exe.dev WIF token request failed (${response.status})`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("exe.dev WIF token response is invalid"); }
  if (!body || typeof body !== "object" || typeof (body as { token?: unknown }).token !== "string") throw new Error("exe.dev WIF token response is invalid");
  return requireJwt((body as { token: string }).token);
}

/** Fly documents POST /v1/tokens/oidc with `aud`; inside a Machine the
 * documented Machines API is exposed on the /.fly/api Unix socket. */
export async function acquireFlyMachineOidcToken(input: {
  guest: Pick<JobGuest, "run">;
  audience: string;
}): Promise<string> {
  if (!input.audience.trim() || input.audience.length > 512) throw new TypeError("Invalid Fly OIDC audience");
  const response = await input.guest.run([
    "curl", "--fail", "--silent", "--show-error", "--max-time", "10",
    "--unix-socket", "/.fly/api", "-X", "POST",
    "-H", "Content-Type: application/json",
    "--data", JSON.stringify({ aud: input.audience }),
    "http://localhost/v1/tokens/oidc",
  ]);
  if (!response.ok) throw new Error("Fly Machine OIDC token request failed");
  return requireJwt(response.stdout);
}

/** Renewal deliberately uses the same vendor source, producing a fresh
 * short-lived token which must pass the same verifier and immutable binding. */
export const renewExeDevWifToken = acquireExeDevWifToken;
export const renewFlyMachineOidcToken = acquireFlyMachineOidcToken;
