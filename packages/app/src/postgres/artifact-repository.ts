import type { ArtifactKind, ArtifactState } from "../artifacts";
import type { Database } from "./database";

export class ArtifactRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }
  async record(input: { runId: string; kind: ArtifactKind; objectKey: string; provider: string; format: string; formatVersion?: string; cliVersion?: string; nativeSessionId?: string; byteSize: number; sha256: string; state?: ArtifactState }) {
    const id = crypto.randomUUID();
    await this.database.transaction(async client => {
      await client.query(`INSERT INTO app.run_artifacts(tenant_id,run_id,id,kind,object_key,provider,format,format_version,cli_version,native_session_id,byte_size,sha256,state)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (tenant_id,object_key) DO UPDATE SET byte_size=excluded.byte_size,sha256=excluded.sha256,state=excluded.state`, [this.tenantId, input.runId, id, input.kind, input.objectKey, input.provider, input.format, input.formatVersion ?? null, input.cliVersion ?? null, input.nativeSessionId ?? null, input.byteSize, input.sha256, input.state ?? "stored"]);
      await client.query("UPDATE app.runs SET artifact_state='stored',artifact_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [this.tenantId, input.runId]);
    });
  }
  async list(runId: string) { return (await this.database.pool.query("SELECT id,kind,object_key,provider,format,format_version,cli_version,native_session_id,byte_size,sha256,state,created_at FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at,id", [this.tenantId, runId])).rows; }
}
