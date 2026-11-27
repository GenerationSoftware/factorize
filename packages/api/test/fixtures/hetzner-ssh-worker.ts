// Test-only Worker for real SSH against a loopback fixture, never deployed.
import { DurableObject } from "cloudflare:workers";
import { HetznerSshPool } from "../../src/integrations/application/hetzner-ssh-pool";
import { connectHetznerSsh, generateHetznerSshKey } from "../../src/integrations/providers/hetzner-ssh-transport";

type Env = { SSH_FIXTURE: DurableObjectNamespace };
export class FixtureBroker extends DurableObject<Env> {
  private readonly pool = new HetznerSshPool(1000);
  private readonly client = generateHetznerSshKey();
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/public") return Response.json({ publicKey: this.client.publicKey });
    if (new URL(request.url).pathname !== "/probe") return new Response(null, { status:404 });
    const { port, fingerprint } = await request.json<{ port: number; fingerprint: string }>();
    try {
      const result = await this.pool.check(fingerprint, closed => connectHetznerSsh({
        address: "127.0.0.1", username: "fixture-check", hostFingerprint: fingerprint,
        privateKey: this.client.privateKey,
      }, closed, port));
      return Response.json(result);
    } catch {
      return new Response(null, { status: 502 });
    }
  }
}
export default { fetch(request: Request, env: Env) {
  return env.SSH_FIXTURE.get(env.SSH_FIXTURE.idFromName("test-connection")).fetch(request);
} };
