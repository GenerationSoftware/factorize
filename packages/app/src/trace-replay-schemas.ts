import { z } from "zod";

export const traceReplayRunIdSchema = z.uuid();
export const traceReplaySchema = z
  .object({
    requestId: z
      .uuid()
      .describe(
        "Tenant-scoped idempotency key; preserve it when retrying. Use a new key to reconsider a previously skipped or unrecoverable run.",
      ),
    source: z
      .enum(["primary", "native_session"])
      .default("primary")
      .describe(
        "Primary replays the persisted source declaration (native for historical runs); native_session selects retained native bytes for other providers or historical native-only Codex runs. Canonical Codex runs reject native replay.",
      ),
  })
  .strict();
