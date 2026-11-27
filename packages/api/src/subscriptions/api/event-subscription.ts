import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiService } from "../../api-service";

const prefix = "factorize://events/";
function eventIdFromUri(uri: string) {
  const match = uri.match(/^factorize:\/\/events\/([0-9a-f-]{36})\/occurrences$/i);
  if (!match || !z.uuid().safeParse(match[1]).success) throw new Error("Expected an Event occurrence URI.");
  return match[1];
}

/** Polls durable occurrence IDs so listeners work across Worker isolates. */
export async function listenForEvents(request: Request, body: any, service: ApiService, server: () => McpServer, credentialActive: () => Promise<boolean>, ctx: ExecutionContext) {
  const uris = z.array(z.string().startsWith(prefix)).min(1).max(32).parse(body.params?.notifications?.resourceSubscriptions);
  const pending = new Map(uris.map(uri => [eventIdFromUri(uri), uri]));
  const states = await service.eventOccurrenceStates([...pending.keys()]);
  const known = new Map(states.map(row => [row.definition_id,row.id]));
  const handler = createMcpHandler(server, { legacy: "reject" });
  const response = await handler.fetch(request, { parsedBody: body });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream")) return response;
  ctx.waitUntil((async () => {
    const deadline = Date.now() + 60_000;
    try {
      while (pending.size && !request.signal.aborted && Date.now() < deadline) {
        const current = await service.eventOccurrenceStates([...pending.keys()]);
        for (const row of current) {
          if (known.get(row.definition_id) === row.id) continue;
          if (!await credentialActive()) return;
          handler.notify.resourceUpdated(pending.get(row.definition_id)!);
          known.set(row.definition_id,row.id);
        }
        if (pending.size) await new Promise(resolve => setTimeout(resolve,1000));
      }
    } finally { await handler.close(); }
  })());
  return response;
}
