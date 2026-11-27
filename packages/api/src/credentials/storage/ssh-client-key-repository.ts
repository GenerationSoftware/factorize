import { z } from "zod";
import { decrypt, encrypt } from "../../crypto";
import type { DatabaseClient } from "../../postgres/database";

const keyPair = z.strictObject({ privateKey: z.string().min(1), publicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+=*$/) });
type KeyPair = z.infer<typeof keyPair>;

export class SshClientKeyRepository {
  constructor(private tenantId: string, private key: string) {}

  async get(sql: DatabaseClient, installationId: string) {
    const kind = "ssh-client-key:" + installationId;
    const { rows } = await sql.query<{encrypted_value: string}>(
      "SELECT encrypted_value FROM app.connections WHERE tenant_id=$1 AND kind=$2", [this.tenantId, kind],
    );
    return rows[0] ? keyPair.parse(JSON.parse(await decrypt(rows[0].encrypted_value, this.key))) : null;
  }

  /** Call while holding the integration topology transaction lock. */
  async getOrCreate(sql: DatabaseClient, installationId: string, create: () => KeyPair) {
    const kind = "ssh-client-key:" + installationId;
    const existing = await this.get(sql, installationId);
    if (existing) return existing;
    const pair = keyPair.parse(create());
    await sql.query("INSERT INTO app.connections(tenant_id,kind,encrypted_value) VALUES($1,$2,$3)", [this.tenantId, kind, await encrypt(JSON.stringify(pair), this.key)]);
    return pair;
  }
}
