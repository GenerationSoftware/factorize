import { listEventsInput, getProcessingAcknowledgmentsInput, setProcessingAcknowledgmentsInput, acknowledgeEventsInput, replayUnacknowledgedEventsInput, subscribeEventInput, unsubscribeEventInput } from "../../subscriptions/api/mcp-event-contracts";

import { McpServer, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";

import { z } from "zod";
import { ServiceError } from "../../api-service";

import { mcpTool } from "../../transport/mcp/tool";
import type { ApiService } from "../../api-service";
import { eventAction } from "../../transport/mcp/errors";

const processingAction = async <T>(action: () => Promise<T>) => {
      try { return await action(); }
      catch (error) {
        if (error instanceof ProtocolError && error.code === -32024) throw new ServiceError(403, "not_authorized", "An active subscription for this OAuth grant is required.");
        if (error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams) throw new ServiceError(400, "invalid_request", error.message);
        throw error;
      }
    };

export function subscriptionsProtocol(server: McpServer, service: ApiService) {
  server.server.setRequestHandler("events/list", { params: listEventsInput }, () => eventAction(() => service.subscriptions.mcpEventCatalog()));
  server.server.setRequestHandler("events/subscribe", { params: subscribeEventInput }, params => eventAction(() => service.subscriptions.mcpSubscribeEvent(params)));
  server.server.setRequestHandler("events/unsubscribe", { params: unsubscribeEventInput }, params => eventAction(() => service.subscriptions.mcpUnsubscribeEvent(params)));
}

export const processingTools = [
  mcpTool("triggers:read", "get_event_processing_acknowledgments", "Read optional processing acknowledgment settings for your exact active MCP subscription. Off by default; independent of HTTP receipt and client-side throttling.", getProcessingAcknowledgmentsInput, service => (input: z.infer<typeof getProcessingAcknowledgmentsInput>) => processingAction(() => service.subscriptions.getEventProcessing(input.subscription_id)), false, true),
  mcpTool("triggers:read", "set_event_processing_acknowledgments", "Opt in to processing acknowledgments for future occurrences on your exact MCP subscription. Turning off waives unresolved acknowledgments and clears cooldown; does not alter standard MCP subscription behavior.", setProcessingAcknowledgmentsInput, service => (input: z.infer<typeof setProcessingAcknowledgmentsInput>) => processingAction(() => service.subscriptions.setEventProcessing(input))),
  mcpTool("triggers:read", "acknowledge_events", "After durable completion or handoff, acknowledge exact original data.occurrenceId UUIDs on your opted-in subscription. Never pass a recovery wake ID or assume an ordered range. Ack successful work promptly; optional cooldown applies only when a new ID is acknowledged, not on retries. Keep client-local pacing and don't drop unfinished work.", acknowledgeEventsInput, service => (input: z.infer<typeof acknowledgeEventsInput>) => processingAction(() => service.subscriptions.acknowledgeEventProcessing(input))),
  mcpTool("triggers:read", "replay_unacknowledged_events", "Queue exact unresolved original occurrence IDs on your opted-in subscription, without duplicating business events or bypassing cooldown. Recovery wakes can have fresh event IDs; deduplicate by their original data.occurrenceId.", replayUnacknowledgedEventsInput, service => (input: z.infer<typeof replayUnacknowledgedEventsInput>) => processingAction(() => service.subscriptions.replayEventProcessing(input.subscription_id, input.event_ids))),
];
