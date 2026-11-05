import { z } from "zod";

/** Maximum UTF-8 bytes accepted from the execution VM. */
export const JOB_RESULT_LIMIT = 64 * 1024;
export const JOB_RESULT_PATH = "/home/exedev/.factorize-job/results.json";

export const jobResultEnvelope = z.object({
  status: z.enum(["succeeded", "failed"]),
  summary: z.string().max(10_000).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().min(1).max(10_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "failed" && !value.reason?.trim()) context.addIssue({ code: "custom", path: ["reason"], message: "A failed result requires a reason" });
});

export type JobResult = z.infer<typeof jobResultEnvelope>;
export function parseJobResult(input: string): JobResult {
  if (new TextEncoder().encode(input).byteLength > JOB_RESULT_LIMIT) throw new Error("Job result exceeds the 64 KiB limit");
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error("Job result is not valid JSON"); }
  return jobResultEnvelope.parse(value);
}

export const JOB_RESULT_INSTRUCTIONS = `\n\n## Required run result\nWrite one JSON object to the absolute path in FACTORIZE_RESULT_PATH before exiting. Use {"status":"succeeded"} when the task is complete, or {"status":"failed","reason":"..."} when it is not. You may include a concise summary and an outputs JSON object. Keep the file at most 64 KiB. Put additional files for this run in ~/.factorize-job/; regular files there are retained as run artifacts.`;
