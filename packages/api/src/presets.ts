import { z } from "zod";
import { presetSlug } from "./skill-definition";
import { teamRunDefaults } from "./flow-schemas";
import { vmPresetSettings } from "./vm-presets";

export const presetKind = z.enum(["vm", "permission", "model"]);
export type PresetKind = z.infer<typeof presetKind>;
export const permissionPresetSettings = teamRunDefaults.pick({ runScopes:true, portableIntegrationIds:true, githubInstallationIds:true, linearConnectionId:true, xConnectionIds:true, allowedTriggerIds:true });
export const modelPresetSettings = teamRunDefaults.pick({ modelAccountId:true, model:true, effort:true });
export const vmSettings = z.union([vmPresetSettings, z.object({provider:z.literal("none")}).strict()]);
const common = {slug:presetSlug,name:z.string().trim().min(1).max(120),expectedRevision:z.number().int().positive().optional()};
export const presetInput = z.discriminatedUnion("kind",[
 z.object({...common,kind:z.literal("vm"),settings:vmSettings}).strict(),
 z.object({...common,kind:z.literal("permission"),settings:permissionPresetSettings}).strict(),
 z.object({...common,kind:z.literal("model"),settings:modelPresetSettings}).strict(),
]);
const output={id:z.uuid(),revision:z.number().int().positive(),isDefault:z.boolean(),executionConfigId:z.string().nullable()};
export const presetResponse=z.discriminatedUnion("kind",[
 presetInput.options[0].omit({expectedRevision:true}).extend(output),
 presetInput.options[1].omit({expectedRevision:true}).extend(output),
 presetInput.options[2].omit({expectedRevision:true}).extend(output),
]);
export type Preset=z.infer<typeof presetResponse>;
export type PresetInput=z.infer<typeof presetInput>;
export const presetList=z.object({presets:z.array(presetResponse)});
