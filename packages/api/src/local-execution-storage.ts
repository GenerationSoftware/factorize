import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Local artifact adapter for the Node runner; keys never become filesystem paths. */
export function createLocalArtifactStorage(directory: string) {
  const path = (key: string) => join(directory, createHash("sha256").update(key).digest("hex"));
  return {
    async put(key: string, value: ReadableStream | Uint8Array | ArrayBuffer | string) {
      await mkdir(directory, { recursive: true });
      const bytes = new Uint8Array(await new Response(value instanceof Uint8Array ? new Uint8Array(value).buffer : value).arrayBuffer());
      if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Local artifact exceeds 64 MiB");
      await writeFile(path(key), bytes, { mode: 0o600 });
      return { key, size: bytes.length };
    },
    async get(key: string) {
      try {
        const bytes = await readFile(path(key));
        return { key, size: bytes.length, body: new Response(bytes).body!, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => new Uint8Array(bytes).buffer };
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async delete(key: string | string[]) { await Promise.all((Array.isArray(key) ? key : [key]).map(key => rm(path(key), { force: true }))); },
  };
}
