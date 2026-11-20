import { z } from "zod";
import { eventSchema } from "./flow-schemas";
import { triggerResponse } from "./job-contracts";
export const skillTriggerResponse=z.object({trigger:triggerResponse.nullable()});
export const skillTriggerInput=z.object({events:z.array(eventSchema).max(50),enabled:z.boolean().default(true),expectedUpdatedAt:z.iso.datetime().optional()}).strict();
