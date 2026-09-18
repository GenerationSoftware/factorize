import { artifactKey } from "./artifacts";
import { hmac } from "./crypto";
import type { Env } from "./types";
import { databaseFor } from "./postgres/database";
import { ArtifactRepository } from "./postgres/artifact-repository";
import { TraceRepository } from "./postgres/trace-repository";

export interface ArtifactUploadGrant {
  tenantId: string;
  runId: string;
  path: string;
  contentType: string;
  provider: "codex" | "claude" | "pi";
  format: "jsonl";
  nativeSessionId?: string;
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
  if (!request.body) return new Response("Artifact body is required", { status: 400 });
  const sha256 = request.headers.get("X-Artifact-SHA256")?.toLowerCase() ?? "", size = Number(request.headers.get("Content-Length"));
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size < 0) return new Response("Artifact checksum and size are required", { status: 400 });
  if (size > 256 * 1024 * 1024) return new Response("Artifact exceeds the 256 MiB limit", { status: 413 });
  const suppliedType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (suppliedType !== grant.contentType.toLowerCase()) return new Response("Artifact content type does not match the grant", { status: 400 });
  const key = artifactKey(grant.tenantId, grant.runId, grant.path);
  const object = await env.RUN_ARTIFACTS.put(key, request.body, { httpMetadata: { contentType: grant.contentType }, customMetadata: { tenantId: grant.tenantId, runId: grant.runId }, sha256 });
  await new ArtifactRepository(databaseFor(env), grant.tenantId).record({ runId: grant.runId, kind: "native_session", objectKey: key, provider: grant.provider, format: grant.format, nativeSessionId: grant.nativeSessionId, byteSize: size, sha256 });
  const stored = await env.RUN_ARTIFACTS.get(key);
  if (!stored) return new Response("Artifact disappeared after upload", { status: 502 });
  await new TraceRepository(databaseFor(env), grant.tenantId).replaceStream(grant.runId, grant.provider, stored.body);
  return Response.json({ key, etag: object.httpEtag }, { status: 201 });
}
