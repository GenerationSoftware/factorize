import { z } from "zod";
import { awsRegions } from "../providers/aws/policy";

export const awsRegion = z.enum(awsRegions);
export const awsCodeInput = z.object({ connectionId: z.uuid(), code: z.string().min(1).max(16_384).refine(value => value.trim().length > 0) }).strict();
export const awsPrepareInput = z.object({ name: z.string().trim().min(1).max(120), region: awsRegion }).strict();
const awsRoleArn = z.string().max(512).regex(/^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9_+=,.@-]+(?:\/[A-Za-z0-9_+=,.@-]+)*$/);
export const awsVerifyInput = z.object({ roleArn: awsRoleArn }).strict();
export const awsGrantInput = z.object({ oauthInstallationId: z.string().min(1).max(512).nullable() }).strict();
export const awsConnectionMetadata = z.object({ id: z.uuid(), name: z.string(), region: awsRegion, roleArn: awsRoleArn.nullable(), oauthInstallationId: z.string().nullable(), revision: z.number().int().nonnegative() });
export const awsConnectionList = z.object({ available: z.boolean(), connections: z.array(awsConnectionMetadata) });
export const awsSetup = z.object({ connection: awsConnectionMetadata, template: z.string() });
export const awsVerified = z.object({ connection: awsConnectionMetadata, verified: z.literal(true) });
