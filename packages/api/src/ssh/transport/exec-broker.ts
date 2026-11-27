import { DurableObject } from "cloudflare:workers";
import type { SshSession } from "edgeport/ssh";
import type { Env } from "../../config/bindings";
import { signingConfig } from "../../config/runtime";
import { SshClientKeyRepository } from "../../credentials/storage/ssh-client-key-repository";
import { databaseFor } from "../../postgres/database";
import { sshBrokerRequest } from "../api/contracts";
import { activeSshClient } from "../application/ssh-service";
import { SshTargetRepository } from "../storage/target-repository";
import { execBounded, openSshSession, SSH_COMMAND_MS, SSH_CONNECT_MS } from "./edgeport-exec";

const idleMs = 30_000, maxAgeMs = 120_000;

function deadline<T>(promise: Promise<T>, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SSH deadline exceeded")), Math.max(0, timeout));
  })]).finally(() => clearTimeout(timer));
}

export class SshExecBroker extends DurableObject<Env> {
  private session?: { transport: SshSession; opened: number; lastUsed: number; fingerprint: string };
  private idle?: ReturnType<typeof setTimeout>;
  private busy = false;

  private close() {
    clearTimeout(this.idle);
    const current = this.session;
    this.session = undefined;
    if (current) this.ctx.waitUntil(current.transport.close().catch(() => {}));
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/exec") return new Response(null, { status: 404 });
    if (this.busy) return new Response(null, { status: 409 });
    this.busy = true;
    clearTimeout(this.idle);
    try {
      const { authority, targetId, command } = sshBrokerRequest.parse(await req.json());
      const name = JSON.stringify([authority.tenantId, authority.userId, authority.oauthInstallationId, targetId]);
      if (this.env.CLIENT_SSH?.idFromName(name).toString() !== this.ctx.id.toString()) return new Response(null, { status: 404 });
      const db = databaseFor(this.env).pool, secret = signingConfig(this.env).credentialKey;
      const targets = new SshTargetRepository(db, authority.tenantId, authority.userId, secret);
      if (!await activeSshClient(db, authority)) { this.close(); return new Response(null, { status: 401 }); }
      const target = await targets.get(targetId);
      if (!target) { this.close(); return new Response(null, { status: 404 }); }
      const keys = new SshClientKeyRepository(authority.tenantId, secret);
      const key = await keys.get(db, authority.oauthInstallationId);
      if (!key) { this.close(); return new Response(null, { status: 409 }); }

      const now = Date.now();
      const fingerprint = JSON.stringify([target.address, target.username, target.hostFingerprint, key.publicKey]);
      if (this.session && (this.session.fingerprint !== fingerprint || now - this.session.lastUsed >= idleMs || now - this.session.opened >= maxAgeMs)) this.close();
      const reusedConnection = !!this.session;
      if (!this.session) {
        const pending = openSshSession(target, key.privateKey);
        try {
          const transport = await deadline(pending, SSH_CONNECT_MS);
          this.session = { transport, opened: Date.now(), lastUsed: Date.now(), fingerprint };
        } catch {
          this.ctx.waitUntil(pending.then(transport => transport.close()).catch(() => {}));
          return new Response(null, { status: 422 });
        }
      }
      const session = this.session;
      if (!await activeSshClient(db, authority)) { this.close(); return new Response(null, { status: 401 }); }
      if (!await targets.get(targetId)) { this.close(); return new Response(null, { status: 404 }); }
      const remaining = maxAgeMs - (Date.now() - session.opened);
      if (remaining <= 0) { this.close(); return new Response(null, { status: 503 }); }
      const result = await deadline(execBounded(session.transport, command), Math.min(SSH_COMMAND_MS, remaining));
      if (!await activeSshClient(db, authority) || !await targets.get(targetId)) {
        this.close(); return new Response(null, { status: 502 });
      }
      session.lastUsed = Date.now();
      return Response.json({ ...result, reusedConnection });
    } catch {
      this.close();
      return new Response(null, { status: 502 });
    } finally {
      this.busy = false;
      if (this.session) this.idle = setTimeout(() => this.close(), Math.min(idleMs, Math.max(0, maxAgeMs - (Date.now() - this.session.opened))));
    }
  }
}
