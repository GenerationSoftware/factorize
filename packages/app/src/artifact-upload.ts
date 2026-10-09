import type { DatabaseClient } from "./postgres/database";
import { artifactKey } from "./artifacts";
import { hmac } from "./crypto";
import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { ArtifactRepository } from "./postgres/artifact-repository";
import { TraceProjectionRepository, TRACE_PARSER_VERSION } from "./postgres/trace-projection-repository";

export interface ArtifactUploadGrant {
  tenantId: string;
  runId: string;
  path: string;
  contentType: string;
  provider: "codex" | "claude" | "pi";
  format: "jsonl";
  nativeSessionId?: string;
  sourceKind?: "execution_stream" | "native_session";
  sourcePath?: string;
  formatVersion?: string;
  cliVersion?: string;
  harnessVersion?: string;
  primary?: boolean;
  /** Execution terminal uploads are bound to the live source generation. */
  traceGeneration?: string | null;
  purpose?: "artifact" | "trace_chunk";
  expiresAt: number;
}

const encoder = new TextEncoder();
const b64url = (value: string) => btoa(String.fromCharCode(...encoder.encode(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromB64url = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)));
};

export async function issueArtifactUploadGrant(grant: ArtifactUploadGrant, secret: string): Promise<string> {
  const payload = b64url(JSON.stringify(grant));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function readArtifactUploadGrant(token: string, secret: string, now = Date.now()): Promise<ArtifactUploadGrant | null> {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator), signature = token.slice(separator + 1);
  if (signature !== await hmac(payload, secret)) return null;
  try {
    const value = JSON.parse(fromB64url(payload)) as ArtifactUploadGrant;
    if (!value.tenantId || !value.runId || !value.path || !value.contentType || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < now) return null;
    if (value.sourceKind && !["execution_stream", "native_session"].includes(value.sourceKind)) return null;
    artifactKey(value.tenantId, value.runId, value.path);
    return value;
  } catch { return null; }
}

/** Private streaming ingress used by guest harnesses. No artifact bytes are buffered. */
export async function artifactUpload(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: { Allow: "PUT" } });
  if (!env.RUN_ARTIFACTS) return new Response("Artifact storage is unavailable", { status: 503 });
  const grant = await readArtifactUploadGrant(token, env.SESSION_SIGNING_SECRET);
  if (!grant || grant.purpose === "trace_chunk") return new Response("Invalid or expired artifact upload grant", { status: 401 });
  if (grant.provider === "codex" && grant.sourceKind !== "execution_stream") return new Response("Codex native artifact capture is disabled; historical receipts remain readable", { status: 409 });
  const sha256 = request.headers.get("X-Artifact-SHA256")?.toLowerCase() ?? "", size = Number(request.headers.get("Content-Length") ?? NaN);
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size < 0) return new Response("Artifact checksum and size are required", { status: 400 });
  if (!request.body && size !== 0) return new Response("Artifact body is required", { status: 400 });
  if (size > 256 * 1024 * 1024) return new Response("Artifact exceeds the 256 MiB limit", { status: 413 });
  const suppliedType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (suppliedType !== grant.contentType.toLowerCase()) return new Response("Artifact content type does not match the grant", { status: 400 });
  if ((grant.sourceKind === "execution_stream" || grant.primary === true) && grant.traceGeneration === undefined) return new Response("Terminal trace generation is required", { status: 400 });
  // Content-addressed stream keys preserve the exact terminal snapshot across retries.
  const key = artifactKey(grant.tenantId, grant.runId, grant.sourceKind === "execution_stream" ? `trace/${sha256}.jsonl` : `native/${sha256}.jsonl`);
  const repository = new ArtifactRepository(databaseFor(env), grant.tenantId);
  const existing = await repository.list(grant.runId);
  const terminal = existing.find(item => item.kind === "execution_stream" && item.state === "stored");
  if (grant.sourceKind === "execution_stream" && terminal && terminal.sha256 !== sha256) return new Response("Terminal trace stream is immutable", { status: 409 });
  const retainedStream = grant.sourceKind === "execution_stream" && terminal;
  if (retainedStream) await request.body?.cancel();
  const object = retainedStream ? null : await env.RUN_ARTIFACTS.put(key, request.body ?? new Uint8Array(), { httpMetadata: { contentType: grant.contentType }, customMetadata: { tenantId: grant.tenantId, runId: grant.runId, generation: grant.traceGeneration ?? "", sourcePath: grant.sourcePath ?? "" }, sha256 });
  const record = (client: DatabaseClient) => repository.record({ runId: grant.runId, kind: grant.sourceKind ?? "native_session", sourceGeneration: grant.traceGeneration, sourcePath: grant.sourcePath, mediaType: grant.contentType, harnessVersion: grant.harnessVersion, formatVersion: grant.formatVersion, cliVersion: grant.cliVersion, objectKey: key, provider: grant.provider, format: grant.format, nativeSessionId: grant.nativeSessionId, byteSize: size, sha256 }, client);
  const stored = await env.RUN_ARTIFACTS.get(key);
  if (!stored) return new Response("Artifact disappeared after upload", { status: 502 });
  if (stored.size !== size) { await stored.body.cancel(); return new Response("Retained artifact size does not match upload receipt", { status: 422 }); }
  const database = databaseFor(env);
  const conflict = await database.transaction(async client => {
    // Shares the lock with incremental ingestion: terminal projection wins atomically.
    const run = (await client.query("SELECT id,trace_sources FROM app.runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [grant.tenantId, grant.runId])).rows[0];
    if (!run) return "Run not found";
    if (grant.sourceKind === "execution_stream" || grant.primary === true) {
      const primary = run.trace_sources?.primary;
      if (primary && (primary.kind !== (grant.sourceKind ?? "native_session") || (primary.provider && primary.provider !== grant.provider) || (primary.path && primary.path !== grant.sourcePath))) return "Terminal trace source mismatch";
      const cursor = (await client.query("SELECT generation FROM app.run_trace_cursors WHERE tenant_id=$1 AND run_id=$2", [grant.tenantId, grant.runId])).rows[0];
      if ((cursor?.generation ?? null) !== grant.traceGeneration) return "Stale terminal trace generation";
    }
    const artifacts = await repository.list(grant.runId, client);
    const terminal = artifacts.find(item => item.kind === "execution_stream" && item.state === "stored");
    if (grant.sourceKind === "execution_stream" && terminal && terminal.sha256 !== sha256) return "Terminal trace stream is immutable";
    const native = artifacts.find(item => item.kind === "native_session" && item.state === "stored");
    if (grant.sourceKind !== "execution_stream" && native && native.sha256 !== sha256) return "Terminal native session is immutable";
    const primary = grant.sourceKind === "execution_stream" || (grant.primary !== false && !terminal && run?.trace_sources?.primary?.kind !== "execution_stream");
    const projection = (await client.query("SELECT source_kind,artifact_sha256,parser_version FROM app.run_trace_projections WHERE tenant_id=$1 AND run_id=$2", [grant.tenantId, grant.runId])).rows[0];
    await record(client);
    // Keep the immutable receipt even when projection fails. A retry projects
    // these retained bytes, rather than replacing them with another guest snapshot.
    await client.query("SAVEPOINT terminal_projection");
    try {
      const alreadyProjected = projection?.source_kind === (grant.sourceKind ?? "native_session") && projection?.artifact_sha256 === sha256 && projection?.parser_version === TRACE_PARSER_VERSION;
      const historicalRollback = grant.provider !== "codex" && terminal && projection?.source_kind === "native_session";
      if (primary && !alreadyProjected && !historicalRollback) await new TraceProjectionRepository(database, grant.tenantId).project(client, grant.runId, { provider: grant.provider, kind: grant.sourceKind ?? "native_session", sha256, byte_size: size }, stored.body, grant.sourceKind === "execution_stream");
      else await stored.body.cancel();
      await client.query("RELEASE SAVEPOINT terminal_projection");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT terminal_projection");
      await client.query("UPDATE app.runs SET artifact_state='partial',artifact_error='Retained primary trace projection failed',updated_at=now() WHERE tenant_id=$1 AND id=$2", [grant.tenantId, grant.runId]);
      return "Retained primary trace projection failed";
    }
    return null;
  });
  if (conflict) return new Response(conflict, { status: 409 });
  return Response.json({ key, etag: object?.httpEtag ?? stored.httpEtag }, { status: 201 });
}
