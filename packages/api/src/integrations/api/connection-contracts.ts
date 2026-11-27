import { z } from "zod";
import { tailIntegration } from "./editor-contracts";
import { okResult } from "../../transport/rest/result-contracts";

export const exeConnection = z.object({ connectionId: z.string(), credentialStatus: z.literal("connected") });
export const ampConnection = z.object({ connectionId: z.string(), project: z.string(), apiBaseUrl: z.string().optional() });
export const integrationStatus = z.object({ linear: z.object({ organizationName: z.string().nullable(), viewerEmail: z.string().nullable() }).nullable(), clickup: z.object({ teamName: z.string().nullable() }).nullable(), exe: exeConnection.nullable(), exeConnections: z.array(exeConnection), ampConnections: z.array(ampConnection), cloudflareTail: z.object({ count: z.number().int(), installations: z.array(tailIntegration) }) });
export const savedExe = okResult.extend({ connectionId: z.string() });
export const savedAmp = okResult.extend({ connectionId: z.string() });
export const savedTail = z.object({ integrationId: z.string(), name: z.string(), status: z.literal("connected"), secretConfigured: z.literal(true), generatedSecret: z.string().optional() });
