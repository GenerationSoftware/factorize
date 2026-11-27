// Test-only Worker for real SSH authentication against a loopback fixture.
import { DurableObject } from "cloudflare:workers";
import { authenticateHetznerSsh, generateHetznerSshKey } from "../../src/integrations/providers/hetzner-ssh-transport";

import type { SshSession } from "edgeport/ssh";
import { execBounded, openSshSession } from "../../src/ssh/transport/edgeport-exec";

type Env = { SSH_FIXTURE: DurableObjectNamespace };
export class FixtureBroker extends DurableObject<Env> {
  private readonly client = generateHetznerSshKey();
  private session?: SshSession;

  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/close") { await this.session?.close(); this.session = undefined; return new Response(null, {status: 204}); }
    if (path === "/public") return Response.json({ publicKey: this.client.publicKey });
    if (path !== "/probe" && path !== "/exec") return new Response(null, { status: 404 });
    const { port, fingerprint, command } = await request.json<{ port: number; fingerprint: string; command?: string }>();
    try {
      if (path === "/exec" && command) {
        const reusedConnection = Boolean(this.session);
        this.session ??= await openSshSession({ id: "test", name: "fixture", address: "127.0.0.1",
          username: "fixture-check", hostFingerprint: fingerprint }, this.client.privateKey, port);
        return Response.json({ ...await execBounded(this.session, command), reusedConnection });
      }
      await authenticateHetznerSsh({ address: "127.0.0.1", username: "fixture-check", hostFingerprint: fingerprint,
        privateKey: this.client.privateKey }, undefined, port);
      return Response.json({ authenticated: true });
    } catch { return new Response(null, { status: 502 }); }
  }
}
export default { fetch(request: Request, env: Env) {
  return env.SSH_FIXTURE.get(env.SSH_FIXTURE.idFromName("test-connection")).fetch(request);
} };
