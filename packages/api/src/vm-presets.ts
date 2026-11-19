import { z } from "zod";
import { jobInputSchema } from "./flow-schemas";
import { flyExecutionConfigurationInput } from "./fly-execution-configurations";

export const vmPresetSettings = z.discriminatedUnion("provider", [
  flyExecutionConfigurationInput.omit({ name: true }).extend({ provider: z.literal("fly") }),
  z.object({
    provider: z.literal("exe"),
    connectionId: z.string().min(1).max(256),
    image: jobInputSchema.shape.vmImage.unwrap().pipe(z.string()),
    tags: jobInputSchema.shape.tags.unwrap(),
  }).strict(),
]);
export const vmPresetInput = z.object({ name: flyExecutionConfigurationInput.shape.name, settings: vmPresetSettings }).strict();
export const vmPreset = vmPresetInput.extend({ id: z.uuid(), executionConfigId: z.string() });
export type VmPresetInput = z.infer<typeof vmPresetInput>;
