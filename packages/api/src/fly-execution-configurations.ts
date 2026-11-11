import { z } from "zod";

export const flyExecutionConfigurationInput = z.object({
  name: z.string().trim().min(1).max(120),
  image: z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/, "Image must be a public image reference."),
  region: z.string().trim().toLowerCase().regex(/^[a-z0-9]{3}$/),
  size: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,64}$/),
}).strict();

export const flyExecutionConfiguration = z.object({
  id: z.guid(), name: z.string(), image: z.string(), region: z.string(), size: z.string(), createdAt: z.string(), updatedAt: z.string(),
});

export type FlyExecutionConfigurationInput = z.infer<typeof flyExecutionConfigurationInput>;
export interface FlyExecutionMetadata { regions: readonly string[]; sizes: readonly string[] }
export type FlyExecutionMetadataLoader = () => Promise<FlyExecutionMetadata>;

/** Keeps provider metadata injected and bounded; stale reads fall back to the last good snapshot. */
export class CachedFlyExecutionMetadata {
  private value?: FlyExecutionMetadata;
  private expiresAt = 0;
  private pending?: Promise<FlyExecutionMetadata>;
  constructor(private readonly loader: FlyExecutionMetadataLoader, private readonly ttlMs = 60_000, private readonly timeoutMs = 2_000, private readonly now = Date.now) {}
  async get(): Promise<FlyExecutionMetadata> {
    if (this.value && this.now() < this.expiresAt) return this.value;
    if (!this.pending) this.pending = Promise.race([
      this.loader(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Fly metadata timeout")), this.timeoutMs)),
    ]).then(value => {
      const parsed = z.object({ regions: z.array(z.string().regex(/^[a-z0-9]{3}$/)).max(200), sizes: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(100) }).parse(value);
      if (!parsed.regions.length || !parsed.sizes.length) throw new Error("Fly metadata is empty");
      this.value = parsed; this.expiresAt = this.now() + this.ttlMs; return parsed;
    }).catch(error => { if (this.value) return this.value; throw error; }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
}

// Static bounded metadata is the safe default; deployments can inject a refreshed provider snapshot.
const defaultMetadata = new CachedFlyExecutionMetadata(async () => ({ regions: ["iad", "ord", "sjc", "lax", "ams", "fra", "lhr", "nrt", "sin"], sizes: ["shared-cpu-1x", "shared-cpu-2x", "shared-cpu-4x", "performance-1x", "performance-2x", "performance-4x"] }));
export const getFlyExecutionMetadata = () => defaultMetadata.get();
