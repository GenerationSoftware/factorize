import { readArtifactUploadGrant } from "./artifact-upload";
import { databaseFor } from "./postgres/database";
import { LiveTraceRepository } from "./postgres/live-trace-repository";
import type { Env } from "./types";

const HASH = /^[0-9a-f]{64}$/;
export async function traceChunkUpload(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: { Allow: "PUT" } });
  const grant = await readArtifactUploadGrant(token, env.SESSION_SIGNING_SECRET);
  if (!grant || grant.purpose !== "trace_chunk") return new Response("Invalid or expired trace upload grant", { status: 401 });
  const generation = request.headers.get("X-Trace-Generation") ?? "", expectedGeneration = request.headers.get("X-Trace-Expected-Generation"), startOffset = Number(request.headers.get("X-Trace-Start"));
  const chunkSha256 = request.headers.get("X-Trace-SHA256") ?? "", previousHash = request.headers.get("X-Trace-Previous-Hash") ?? "";
  const size = Number(request.headers.get("Content-Length"));
  if (!generation || generation.length > 200 || !Number.isSafeInteger(startOffset) || startOffset < 0 || !HASH.test(chunkSha256) || !HASH.test(previousHash) || !Number.isSafeInteger(size) || size < 1 || size > 4 * 1024 * 1024) return new Response("Invalid trace chunk metadata", { status: 400 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== size) return new Response("Trace chunk size mismatch", { status: 400 });
  try {
    const result = await new LiveTraceRepository(databaseFor(env), grant.tenantId).append(grant.runId, grant.provider, { generation, expectedGeneration: expectedGeneration || null, startOffset, chunkSha256, previousHash, bytes });
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trace chunk ingestion failed";
    return Response.json({ error: message }, { status: message.includes("mismatch") || message.includes("changed") || message.includes("Conflicting") || message.includes("Stale") ? 409 : 400 });
  }
}
