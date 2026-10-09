import type { ArtifactKind, ArtifactState } from "../artifacts";
import type { Database, DatabaseClient } from "./database";
import { and, eq } from "drizzle-orm";
import { runArtifacts, runs } from "./schema";

export class ArtifactRepository {
  constructor(private database: Database, private tenantId: string) { if (!tenantId) throw new Error("tenantId is required"); }
  async record(input: { runId: string; kind: ArtifactKind; objectKey: string; provider: string; format: string; formatVersion?: string; cliVersion?: string; nativeSessionId?: string; sourceGeneration?: string | null; sourcePath?: string; mediaType?: string; harnessVersion?: string; byteSize: number; sha256: string; state?: ArtifactState }, client?: DatabaseClient) {
    const id = crypto.randomUUID();
    const write = async (client: DatabaseClient) => {
      await client.query(`INSERT INTO app.run_artifacts(tenant_id,run_id,id,kind,object_key,provider,format,format_version,cli_version,native_session_id,byte_size,sha256,state,source_path,media_type,harness_version,source_generation)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (tenant_id,object_key) DO UPDATE SET byte_size=excluded.byte_size,sha256=excluded.sha256,state=excluded.state`, [this.tenantId, input.runId, id, input.kind, input.objectKey, input.provider, input.format, input.formatVersion ?? null, input.cliVersion ?? null, input.nativeSessionId ?? null, input.byteSize, input.sha256, input.state ?? "stored", input.sourcePath ?? null, input.mediaType ?? null, input.harnessVersion ?? null, input.sourceGeneration ?? null]);
      await client.query("UPDATE app.runs SET artifact_state='stored',updated_at=now() WHERE tenant_id=$1 AND id=$2", [this.tenantId, input.runId]);
    };
    if (client) await write(client); else await this.database.transaction(write);
  }
  async list(runId: string, client: DatabaseClient = this.database.pool) { return (await client.query("SELECT id,kind,object_key,provider,format,format_version,cli_version,native_session_id,byte_size,sha256,state,source_path,media_type,harness_version,source_generation,created_at FROM app.run_artifacts WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at,id", [this.tenantId, runId])).rows; }
  async keysForJob(jobId: string): Promise<string[]> {
    const rows = await this.database.orm.select({ key: runArtifacts.objectKey }).from(runArtifacts).innerJoin(runs, and(eq(runs.tenantId, runArtifacts.tenantId), eq(runs.id, runArtifacts.runId))).where(and(eq(runArtifacts.tenantId, this.tenantId), eq(runs.jobId, jobId)));
    return rows.map(row => row.key);
  }
}
