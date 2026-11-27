// Test-only Worker for real SSH authentication against a loopback fixture.
import { DurableObject } from "cloudflare:workers";
import { authenticateHetznerSsh, generateHetznerSshKey } from "../../src/integrations/providers/hetzner-ssh-transport";

type Env = { SSH_FIXTURE: DurableObjectNamespace };
export class FixtureBroker extends DurableObject<Env> {
  private readonly client = generateHetznerSshKey();
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/public") return Response.json({ publicKey: this.client.publicKey });
    if (new URL(request.url).pathname !== "/probe") return new Response(null, { status: 404 });
    const { port, fingerprint } = await request.json<{ port: number; fingerprint: string }>();
    try {
      await authenticateHetznerSsh({ address: "127.0.0.1", username: "fixture-check", hostFingerprint: fingerprint,
        privateKey: this.client.privateKey }, undefined, port);
      return Response.json({ authenticated: true });
    } catch { return new Response(null, { status: 502 }); }
  }
}
export default { fetch(request: Request, env: Env) {
  return env.SSH_FIXTURE.get(env.SSH_FIXTURE.idFromName("test-connection")).fetch(request);
} };
