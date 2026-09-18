export type ArtifactKind = "native_session" | "related_session" | "terminal_log" | "manifest";
export type ArtifactState = "pending" | "collecting" | "stored" | "partial" | "failed";

export interface RunArtifact {
  id: string;
  runId: string;
  kind: ArtifactKind;
  objectKey: string;
  provider: string;
  format: string;
  formatVersion?: string;
  cliVersion?: string;
  nativeSessionId?: string;
  byteSize: number;
  sha256: string;
  state: ArtifactState;
}

export interface ArtifactWrite {
  key: string;
  body: ReadableStream | ArrayBuffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

/** Blob storage boundary. Execution and agent drivers do not depend on R2. */
export interface ArtifactStore {
  put(input: ArtifactWrite): Promise<{ key: string; etag?: string }>;
  get(key: string, range?: { offset: number; length: number }): Promise<ReadableStream | null>;
  delete(key: string): Promise<void>;
}

/** R2 implementation; keys are always supplied from PostgreSQL, never discovered by listing. */
export class R2ArtifactStore implements ArtifactStore {
  constructor(private bucket: R2Bucket) {}

  async put(input: ArtifactWrite): Promise<{ key: string; etag?: string }> {
    const object = await this.bucket.put(input.key, input.body, {
      httpMetadata: input.contentType ? { contentType: input.contentType } : undefined,
      customMetadata: input.metadata,
    });
    return { key: input.key, etag: object?.httpEtag };
  }

  async get(key: string, range?: { offset: number; length: number }): Promise<ReadableStream | null> {
    const object = await this.bucket.get(key, range ? { range } : undefined);
    return object?.body ?? null;
  }

  async delete(key: string): Promise<void> { await this.bucket.delete(key); }
}

export function artifactKey(tenantId: string, runId: string, relativePath: string): string {
  const safe = relativePath.split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  if (!safe || relativePath.includes("..")) throw new Error("Invalid artifact path");
  return `tenants/${encodeURIComponent(tenantId)}/runs/${encodeURIComponent(runId)}/${safe}`;
}
