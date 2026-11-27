import type { AGENT_SCOPES } from "../access-control/domain/scopes";
import { databaseFor } from "../postgres/database";
import type { Env, OAuthProps } from "../types";
import { authorizeEnrichment } from "./application/event-enrichment";
import { EventsService } from "./application/events-service";
import { EventDefinitionRepository } from "./storage/event-definition-repository";
import { readEnrichmentRuns, readOccurrenceStates } from "./storage/event-read-model";
import { readOccurrenceSummaries } from "./storage/occurrence-summary-repository";

export function eventsFor(env: Env, auth: OAuthProps, authorize: (scope: (typeof AGENT_SCOPES)[number]) => Promise<void>) {
  return new EventsService({
    definitions: () => new EventDefinitionRepository(databaseFor(env), auth.tenantId),
    authorize,
    authorizeEnrichment: config => authorizeEnrichment(env, auth, config),
    readEnrichmentRuns: id => readEnrichmentRuns(databaseFor(env), auth.tenantId, id),
    readOccurrenceStates: ids => readOccurrenceStates(databaseFor(env), auth.tenantId, ids),
    readSummaries: (id, limit, cursor) => readOccurrenceSummaries(databaseFor(env), auth.tenantId,
      { kind: "event", id }, limit, cursor),
    authMethod: auth.authMethod,
  });
}
