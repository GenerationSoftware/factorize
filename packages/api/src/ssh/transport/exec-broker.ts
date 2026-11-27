import { DurableObject } from "cloudflare:workers";
import type { SshSession } from "edgeport/ssh";
import type { Env } from "../../config/bindings";
import { signingConfig } from "../../config/runtime";
import { SshClientKeyRepository } from "../../credentials/storage/ssh-client-key-repository";
import { databaseFor } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import { resolveHetznerSshTarget } from "../application/hetzner-target";
import { sshBrokerRequest, sshRoutingTarget } from "../api/contracts";
import { activeSshClient } from "../application/ssh-service";
import { SshTargetRepository } from "../storage/target-repository";
import { execBounded, openSshSession, SshHostFingerprintMismatch, SSH_COMMAND_MS, SSH_CONNECT_MS } from "./edgeport-exec";

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
      const input = sshBrokerRequest.parse(await req.json());
      const { authority, targetId, hetznerServerId, username, command } = input;
      const name = JSON.stringify([authority.tenantId, authority.userId, authority.oauthInstallationId, sshRoutingTarget(input)]);
      if (this.env.CLIENT_SSH?.idFromName(name).toString() !== this.ctx.id.toString()) return new Response(null, { status: 404 });
      const db = databaseFor(this.env).pool, secret = signingConfig(this.env).credentialKey;
      const targets = new SshTargetRepository(db, authority.tenantId, authority.userId, secret);
      if (!await activeSshClient(db, authority)) { this.close(); return new Response(null, { status: 401 }); }
      let target: Parameters<typeof openSshSession>[0] | null;
      let persist: Awaited<ReturnType<typeof resolveHetznerSshTarget>>["persist"] | undefined;
      let current: () => Promise<boolean>;
      let markMismatch: (() => Promise<void>) | undefined;
      if (hetznerServerId !== undefined) {
        try {
          const resolved = await resolveHetznerSshTarget(this.env, authority, hetznerServerId, username);
          ({ target, current, markMismatch, persist } = resolved);
        } catch (error) {
          this.close();
          const status = error instanceof ServiceError && (error.status === 403 || error.status === 412) ? error.status : 424;
          return new Response(null, { status });
        }
      } else {
        target = await targets.get(targetId!);
        current = async () => Boolean(await targets.get(targetId!));
      }
      if (!target) { this.close(); return new Response(null, { status: 404 }); }
      const keys = new SshClientKeyRepository(authority.tenantId, secret);
      const key = await keys.get(db, authority.oauthInstallationId);
      if (!key) { this.close(); return new Response(null, { status: 409 }); }

      const now = Date.now();
      const identity = (t: NonNullable<typeof target>) => JSON.stringify([t.id, t.address, t.username, t.hostFingerprint, key.publicKey]);
      const fingerprint = identity(target);
      if (this.session && (this.session.fingerprint !== fingerprint || now - this.session.lastUsed >= idleMs || now - this.session.opened >= maxAgeMs)) this.close();
      const reusedConnection = !!this.session;
      if (!this.session) {
        let observed: string | undefined;
        const firstUse = target.hostFingerprint === null;
        const pending = firstUse
          ? openSshSession(target, key.privateKey, 22, fingerprint => { observed = fingerprint; })
          : openSshSession(target, key.privateKey);
        try {
          const transport = await deadline(pending, SSH_CONNECT_MS);
          this.session = { transport, opened: Date.now(), lastUsed: Date.now(), fingerprint };
        } catch (error) {
          this.ctx.waitUntil(pending.then(transport => transport.close()).catch(() => {}));
          if (error instanceof SshHostFingerprintMismatch) {
            await markMismatch?.();
            return new Response(null, { status: 421 });
          }
          return new Response(null, { status: 422 });
        }
        if (firstUse) {
          // Never save a key from a failed login or run a command before the pin is durable.
          const status = observed && persist ? await persist(observed) : "stale";
          if (status !== "saved") {
            this.close();
            return new Response(null, { status: status === "changed" ? 421 : 412 });
          }
          this.session.fingerprint = identity(target);
        }
      }
      const session = this.session;
      if (!await activeSshClient(db, authority)) { this.close(); return new Response(null, { status: 401 }); }
      if (!await current()) { this.close(); return new Response(null, { status: hetznerServerId === undefined ? 404 : 412 }); }
      const remaining = maxAgeMs - (Date.now() - session.opened);
      if (remaining <= 0) { this.close(); return new Response(null, { status: 503 }); }
      const result = await deadline(execBounded(session.transport, command), Math.min(SSH_COMMAND_MS, remaining));
      if (!await activeSshClient(db, authority) || !await current()) {
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
