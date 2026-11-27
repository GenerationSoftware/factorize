import { readOccurrenceSummaries } from "../../events/storage/occurrence-summary-repository";
import { subscriptionOccurrenceSummaryPage, parseOccurrenceSummaryCursor } from "../../events/api/event-contracts";

import { eventPayloadSchema, occurrenceEventName, occurrenceInputSchema, type subscribeEventInput, type unsubscribeEventInput, type setProcessingAcknowledgmentsInput, type acknowledgeEventsInput } from "../api/mcp-event-contracts";
import { subscribeMcpEvent, unsubscribeMcpEvent, getProcessingAcknowledgments, setProcessingAcknowledgments, acknowledgeEvents, replayUnacknowledgedEvents } from "./mcp-event-subscriptions";

import { z } from "zod";

import { databaseFor } from "../../postgres/database";

import { readEventSubscriptions } from "../storage/event-subscription-repository";
import { eventSubscription, eventSubscriptionList } from "../../events/api/event-contracts";

import { ServiceError, publicValue } from "../../service-contract";

import type { Env, OAuthProps } from "../../types";
import type { AGENT_SCOPES } from "../../access-tokens";
export class SubscriptionsService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>, private authorizeOwnerSession: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {}

  private occurrenceSummaryBoundary(id: string, cursor?: string) {
    if (cursor === undefined) return undefined;
    const boundary = parseOccurrenceSummaryCursor(cursor, id);
    if (!boundary) throw new ServiceError(400, "invalid_request", "Cursor does not match this occurrence history.");
    return boundary;
  }

  async listDashboardEventSubscriptions() {
    await this.authorizeOwnerSession("triggers:read");
    return publicValue(eventSubscriptionList, await readEventSubscriptions(databaseFor(this.env), this.auth.tenantId, this.auth.userId));
  }

  async getDashboardEventSubscription(id: string) {
    await this.authorizeOwnerSession("triggers:read");
    const [result] = await readEventSubscriptions(databaseFor(this.env), this.auth.tenantId, this.auth.userId, id);
    if (!result) throw new ServiceError(404, "not_found", "Event subscription not found");
    return publicValue(eventSubscription, result);
  }

  async listSubscriptionOccurrences(id: string, limit: number, cursor?: string) {
    await this.authorizeOwnerSession("triggers:read");
    const result = await readOccurrenceSummaries(databaseFor(this.env), this.auth.tenantId,
      { kind: "subscription", id, userId: this.auth.userId }, limit, this.occurrenceSummaryBoundary(id, cursor));
    if (!result) throw new ServiceError(404, "not_found", "Event subscription not found");
    return publicValue(subscriptionOccurrenceSummaryPage, result);
  }

  async mcpEventCatalog() {
    await this.authorize("triggers:read");
    return {
      events: [{
        name: occurrenceEventName,
        title: "Factorize occurrence",
        description: "A wake for the selected Factorize Event UUID. HTTP 2xx confirms callback acceptance, not processing. Optional subscription acknowledgments use exact original data.occurrenceId, never UUID ordering; recovery wakes may have a fresh eventId.",
        delivery: ["webhook"],
        inputSchema: occurrenceInputSchema,
        payloadSchema: eventPayloadSchema,
      }],
    };
  }

  async mcpSubscribeEvent(input: z.infer<typeof subscribeEventInput>) {
    await this.authorize("triggers:read");
    return subscribeMcpEvent(this.env, this.auth, input);
  }

  async mcpUnsubscribeEvent(input: z.infer<typeof unsubscribeEventInput>) {
    await this.authorize("triggers:read");
    return unsubscribeMcpEvent(this.env, this.auth, input);
  }

  async getEventProcessing(subscriptionId: string) {
    await this.authorize("triggers:read");
    return getProcessingAcknowledgments(this.env, this.auth, subscriptionId);
  }

  async setEventProcessing(input: z.infer<typeof setProcessingAcknowledgmentsInput>) {
    await this.authorize("triggers:read");
    return setProcessingAcknowledgments(this.env, this.auth, input);
  }

  async acknowledgeEventProcessing(input: z.infer<typeof acknowledgeEventsInput>) {
    await this.authorize("triggers:read");
    return acknowledgeEvents(this.env, this.auth, input);
  }

  async replayEventProcessing(subscriptionId: string, ids: string[]) {
    await this.authorize("triggers:read");
    return replayUnacknowledgedEvents(this.env, this.auth, subscriptionId, ids);
  }
}
