import { queryOf } from "./query-params";

import { z } from "zod";

import { triggerConditionsTestSchema, triggerIdSchema, mcpTriggerInputSchema, fireTriggerInputSchema, type TriggerInput } from "../../triggers/api/trigger-schemas";

import { mcpTool } from "../../transport/mcp/tool";

export const triggerTools = [
  mcpTool("triggers:read", "list_triggers", "List triggers and their parent Events", z.object({}), service => () => service.triggers.listTriggers()),
  mcpTool("triggers:read", "get_trigger", "Get a Trigger, its parent Event, and input configuration", triggerIdSchema, service => ({ triggerId }: any) => service.triggers.getTrigger(triggerId)),
  mcpTool("triggers:write", "create_trigger", "Create an input Trigger attached to an Event. Credentials are never accepted or returned.", mcpTriggerInputSchema, service => (input: TriggerInput) => service.triggers.createTrigger(input)),
  mcpTool("triggers:write", "update_trigger", "Replace a Trigger's input configuration and Event parent.", mcpTriggerInputSchema.extend({ triggerId: z.string().min(1) }), service => ({ triggerId, ...input }: TriggerInput & { triggerId: string }) => service.triggers.updateTrigger(triggerId, input)),
  mcpTool("triggers:write", "delete_trigger", "Delete an input Trigger", triggerIdSchema, service => ({ triggerId }: any) => service.triggers.deleteTrigger(triggerId)),
  mcpTool("triggers:write", "enable_trigger", "Enable a trigger", triggerIdSchema, service => ({ triggerId }: any) => service.triggers.setTriggerEnabled(triggerId, true)),
  mcpTool("triggers:write", "disable_trigger", "Disable a trigger", triggerIdSchema, service => ({ triggerId }: any) => service.triggers.setTriggerEnabled(triggerId, false)),
  mcpTool("triggers:write", "fire_trigger", "Fire an enabled Trigger and persist an Event occurrence. Reuse idempotencyKey to make retries safe.", fireTriggerInputSchema.extend({ triggerId: z.uuid() }), service => ({ triggerId, ...input }: any) => service.triggers.fireTrigger(triggerId, input)),
  mcpTool("triggers:read", "list_trigger_webhook_activity", "List matching, rejected, duplicate, and accepted webhook activity for a trigger", z.object({ triggerId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }), service => ({ triggerId, limit }: any) => service.triggers.listTriggerEvents(triggerId, limit)),
  mcpTool("triggers:read", "list_webhook_deliveries", "Search tenant-scoped webhook deliveries by provider, delivery ID, event, outcome, trigger, time range, or safe diagnostic text. Results are newest first and cursor paginated.", z.object({ provider: z.string().optional(), deliveryId: z.string().optional(), event: z.string().optional(), action: z.string().optional(), outcome: z.string().optional(), triggerId: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().optional() }), service => (input: any) => service.triggers.listWebhookDeliveries(queryOf(input))),
  mcpTool("triggers:read", "get_webhook_delivery", "Get a webhook delivery and its safe processing timeline. Secrets and payloads are never returned.", z.object({ deliveryId: z.string().min(1) }), service => ({ deliveryId }: any) => service.triggers.getWebhookDelivery(deliveryId)),
  mcpTool("triggers:write", "test_trigger_webhook_conditions", "Evaluate conditions on supplied prepared webhook context. No authentication of the example, routing, live GitHub verification, or Trigger firing.", triggerConditionsTestSchema, service => (input: any) => service.triggers.testTriggerConditions(input)),
];
