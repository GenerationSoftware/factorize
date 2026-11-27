import { Buffer } from "node:buffer";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { AgentApiError } from "./agent-api-error";
import { databaseFor } from "./postgres/database";
import { FlyConnectionRepository } from "./postgres/fly-connection-repository";
import type { VmGrant, VmIdentityBinding, VmProvider } from "./postgres/vm-grant-repository";
import type { Env } from "./types";
import { discoverVendorIssuerTrust, verifyVendorMachineIdentity } from "./vm-oidc";

const flyOrigin = "https://api.machines.dev";
const disabled = () => new AgentApiError(503, "provider_unavailable", "VM permission grants are unavailable for this provider.");
const unavailable = () => new AgentApiError(502, "vm_verification_failed", "Could not verify the VM through its provider connection.");

export function vmGrantAudience(id: string) {
  return `factorize://vm-grants/${id}`;
}

export function requireVmGrantProvider(provider: VmProvider) {
  // exe.dev has yet to expose documented evidence of continuity across a
  // same-name replacement. A WIF subject or attachment must never bypass this.
  if (provider !== "fly") throw disabled();
}

const flyApp = z.object({ name: z.string(), organization: z.object({ slug: z.string() }) });
const flyMachine = z.object({ id: z.string(), name: z.string().min(1), state: z.string() });
const flyExec = z.object({ stdout: z.string().max(44_000), exit_code: z.literal(0) });
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseFlyOidcToken(body: string): string {
  // Fly's guest socket returns a compact JWT, not a JSON object.
  const token = body.trim();
  if (token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw unavailable();
  return token;
}

const enrollmentScript = `set -efu
umask 077
dir="$HOME/.factorize-vm-grants"
mkdir -p "$dir"
key="$dir/$1.pem"
if [ ! -f "$key" ]; then
  tmp=$(mktemp "$dir/.key.XXXXXXXX")
  trap 'rm -f "$tmp"' EXIT
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp"
  ln "$tmp" "$key" || test -f "$key"
fi
public_key=$(openssl pkey -in "$key" -pubout -outform DER | openssl base64 -A)
proof=$(printf %s "$2" | openssl dgst -sha256 -sign "$key" | openssl base64 -A)
response=$(curl --max-time 10 --fail --silent --show-error --unix-socket /.fly/api \\
  -H 'Content-Type: application/json' -d "{\\"aud\\":\\"$3\\"}" http://localhost/v1/tokens/oidc)
printf '%s\\n%s\\n' "$public_key" "$proof"
printf %s "$response" | openssl base64 -A
`;

export async function flyVmGrantProvider(env: Env, grant: Pick<VmGrant, "id" | "tenant_id" | "provider_kind" | "vm" | "vm_app">) {
  requireVmGrantProvider(grant.provider_kind);
  const repo = new FlyConnectionRepository(databaseFor(env), grant.tenant_id, env.CREDENTIAL_ENCRYPTION_KEY);
  const [connection, token] = await Promise.all([repo.get(), repo.token()]);
  if (!connection || !token) throw unavailable();

  const appPath = `/v1/apps/${encodeURIComponent(grant.vm_app)}`;
  const machinePath = `${appPath}/machines/${encodeURIComponent(grant.vm)}`;
  const audience = vmGrantAudience(grant.id);
  const issuer = `https://oidc.fly.io/${connection.organizationSlug}`;

  async function read(path: string, body?: unknown) {
    const response = await fetch(flyOrigin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(body === undefined ? 10_000 : 25_000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw unavailable();
    }
    return response.json();
  }

  async function inspect() {
    const [app, machine] = await Promise.all([read(appPath).then(flyApp.parse), read(machinePath).then(flyMachine.parse)]);
    if (app.name !== grant.vm_app || app.organization.slug !== connection!.organizationSlug
        || machine.id !== grant.vm || machine.state !== "started") throw unavailable();
    return {
      provider: "fly.io" as const,
      issuer,
      audience,
      machineId: machine.id,
      machineKey: `${connection!.organizationSlug}/${app.name}/${machine.id}`,
      subject: `${connection!.organizationSlug}:${app.name}:${machine.name}`,
    };
  }

  return {
    async enroll(): Promise<VmIdentityBinding> {
      try {
        const binding = await inspect();
        const challenge = crypto.randomUUID();
        const result = flyExec.parse(await read(machinePath + "/exec", {
          command: ["/bin/sh", "-c", enrollmentScript, "factorize-enroll", grant.id, challenge, audience],
          timeout: 20,
        }));
        const material = result.stdout.trim().split("\n");
        if (material.length !== 3 || material.some(value => !base64.test(value))) throw unavailable();
        const publicKey = createPublicKey({ key: Buffer.from(material[0]!, "base64"), type: "spki", format: "der" });
        const jwk = publicKey.export({ format: "jwk" });
        if (jwk.kty !== "EC" || jwk.crv !== "P-256"
            || !verify("sha256", Buffer.from(challenge), publicKey, Buffer.from(material[1]!, "base64"))) throw unavailable();
        const identityToken = parseFlyOidcToken(Buffer.from(material[2]!, "base64").toString("utf8"));
        const trust = await discoverVendorIssuerTrust(binding);
        await verifyVendorMachineIdentity({ token: identityToken, binding, resolveKey: trust.resolveKey });
        return { machine_key: binding.machineKey, issuer: binding.issuer, subject: binding.subject, public_key: jwk };
      } catch {
        throw unavailable();
      }
    },
    async authenticate(token: string, grant: Pick<VmGrant, "machine_key" | "issuer" | "subject">) {
      const binding = await inspect();
      if (grant.machine_key !== binding.machineKey || grant.issuer !== binding.issuer || grant.subject !== binding.subject) throw unavailable();
      const trust = await discoverVendorIssuerTrust(binding);
      return verifyVendorMachineIdentity({ token, binding, resolveKey: trust.resolveKey });
    },
  };
}
