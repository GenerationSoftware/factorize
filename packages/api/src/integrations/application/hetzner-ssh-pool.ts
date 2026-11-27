import type { ProbableSshConnection } from "../providers/hetzner-ssh-transport";

export class HetznerSshPool {
  private active: { identity: string; connection: ProbableSshConnection } | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  constructor(private idleMs = 30_000) {}

  close() {
    clearTimeout(this.idle);
    const active = this.active;
    this.active = undefined;
    active?.connection.close();
  }

  async check(identity: string, dial: (onClosed: () => void) => Promise<ProbableSshConnection>) {
    if (this.busy) return { busy: true } as const;
    this.busy = true;
    clearTimeout(this.idle);
    try {
      if (this.active?.identity !== identity) this.close();
      const reusedConnection = Boolean(this.active);
      if (!this.active) {
        let connection: ProbableSshConnection | undefined;
        connection = await dial(() => { if (connection && this.active?.connection === connection) this.close(); });
        this.active = { identity, connection };
      }
      await this.active.connection.check();
      if (this.active) this.idle = setTimeout(() => this.close(), this.idleMs);
      return { reusedConnection } as const;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
