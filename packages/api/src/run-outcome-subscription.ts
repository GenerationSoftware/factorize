import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiService, ServiceError } from "./flow-service";

const uriPrefix = "factorize://runs/";
export function outcomeRunId(uri: string) {
  const id = uri.slice(uriPrefix.length, -"/outcome".length);
  if (!z.guid().safeParse(id).success || uri !== uriPrefix + id + "/outcome")
    throw new ServiceError(400, "invalid_resource", "Expected a run outcome URI.");
  return id;
}

// One SDK listen stream belongs to one authenticated request. Read the
// committed outcome IDs from PostgreSQL so a scheduler in any isolate can
// wake this stream, including when the run finished before the listener opened.
export async function listenForOutcomes(
  request: Request,
  body: any,
  service: ApiService,
  server: () => McpServer,
  credentialActive: () => Promise<boolean>,
  ctx: ExecutionContext,
) {
  const uris = z.array(z.string()).min(1).max(32).parse(body.params?.notifications?.resourceSubscriptions);
  const pending = new Map(uris.map((uri) => [outcomeRunId(uri), uri]));
  await service.outcomeStates([...pending.keys()]);
  const handler = createMcpHandler(server, { legacy: "reject" });
  const response = await handler.fetch(request, { parsedBody: body });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream")) return response;
  const watch = async () => {
    // Close periodically so the next listen passes through the full HTTP authentication boundary.
    const deadline = Date.now() + 60_000;
    try {
      while (pending.size && !request.signal.aborted && Date.now() < deadline) {
        const states = await service.outcomeStates([...pending.keys()]);
        for (const row of states) {
          if (!row.outcome_id) continue;
          if (!(await credentialActive())) return;
          handler.notify.resourceUpdated(pending.get(row.id)!);
          pending.delete(row.id);
        }
        if (pending.size) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      await handler.close();
    }
  };
  ctx.waitUntil(watch());
  return response;
}
