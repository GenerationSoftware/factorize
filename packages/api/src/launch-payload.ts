import { z } from "zod";
import type { LaunchRequest } from "./execution";

export const LAUNCH_PAYLOAD_LIMIT = 32 * 1024 * 1024;
const fields = {
  version: z.literal(1),
  runId: z.guid(),
  // The launcher validates trace paths before writing to them.
  traceSources: z.record(z.string(), z.unknown()).optional(),
};
export const launchPayloadResponse = z.union([
  z.object({ ...fields, prompt: z.string(), harness: z.object({
    executable: z.string().min(1), args: z.array(z.string()), env: z.record(z.string(), z.string()),
  }).strict() }).strict(),
  z.object({ ...fields, code: z.object({ script: z.string(), context: z.record(z.string(), z.unknown()) }).strict() }).strict(),
]);

/** Snapshot exactly what the scheduler would otherwise transfer inline. */
export function serializeLaunchPayload(request: LaunchRequest): string {
  const value = JSON.stringify({ version: 1, runId: request.runId,
    ...(request.code ? { code: request.code } : { prompt: request.prompt, harness: request.harness }),
    ...(request.traceSources ? { traceSources: request.traceSources } : {}),
  });
  if (new TextEncoder().encode(value).byteLength > LAUNCH_PAYLOAD_LIMIT) throw new Error("Launch payload exceeds 32 MiB");
  return value;
}
