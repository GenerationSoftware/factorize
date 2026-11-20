import { z } from "zod";
import { teamRunDefaults } from "./flow-schemas";
export const skillDefaults = teamRunDefaults.omit({capacity:true}).extend({
  vmImage:z.string().trim().max(512).refine(value=>teamRunDefaults.shape.vmImage.safeParse(value).success,"Enter a public Docker/OCI image reference without a URL scheme.").describe("Public Docker/OCI image reference, or blank for the provider default.").optional(),
  executionType:z.enum(["agent","code"]).default("agent"),
  prompt:z.string().max(50_000).default(""),
  script:z.string().max(200_000).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.executionType==="code" && (!value.script?.trim() || value.requiresVm===false))ctx.addIssue({code:"custom",message:"Scripts require a script and a VM."});
});
export const skillSettings = z.object({revision:z.number().int().positive(),defaults:skillDefaults});
export const skillSettingsInput = z.object({expectedRevision:z.number().int().positive(),defaults:skillDefaults}).strict();
