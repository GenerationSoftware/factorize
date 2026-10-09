import { z } from "zod";
export const executionTargetResponse = z.object({
  id: z.string(), kind: z.enum(["exe-vm", "amp"]), name: z.string(), workspace: z.string(), cwd: z.string(), agentKind: z.string(),
  models: z.array(z.string()).optional(), modelsRefreshedAt: z.string().nullable().optional(), efforts: z.array(z.string()).optional(), capabilities: z.array(z.string()),
});
export const triggerAvailabilityResponse = z.object({ manual: z.literal(true), schedule: z.literal(true), jobLifecycle: z.literal(true), linear: z.boolean(), clickup: z.boolean(), github: z.boolean(), cloudflareTail: z.boolean() });
export const namedOption = z.object({ id: z.string(), name: z.string() });
export const providerOptions = z.object({ statuses: z.array(namedOption), users: z.array(namedOption), labels: z.array(namedOption) });
export const githubInstallation = z.object({ installationId: z.union([z.number().int(), z.string().regex(/^[0-9]+$/)]), accountLogin: z.string(), accountType: z.string(), state: z.string(), updatedAt: z.string() });
export const githubRepository = z.object({ id: z.number().int(), name: z.string(), fullName: z.string(), owner: z.string(), private: z.boolean(), defaultBranch: z.string() });
export const tailIntegration = z.object({ integrationId: z.string(), name: z.string(), status: z.literal("connected"), secretConfigured: z.literal(true), createdAt: z.string().optional(), updatedAt: z.string().optional(), referencedJobCount: z.number().int() });
