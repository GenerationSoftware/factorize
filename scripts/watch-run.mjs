import { setTimeout as delay } from "node:timers/promises";

class RetryableTransportError extends Error {}

// Host adapter for an MCP background run. Persist the conversation ID and URI
// when dispatching. deliver() must idempotently append by eventId so a crash
// between delivery and acknowledgment can safely replay the outcome.
export async function watchRun({ request, conversationId, outcomeUri, deliver, signal }) {
  const version = "2026-07-28";
  let id = 0;
  async function rpc(method, params, connectionSignal) {
    const response = await request(
      {
        jsonrpc: "2.0",
        id: ++id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "factorize-run-watcher", version: "1" },
          },
        },
      },
      {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": version,
        "Mcp-Method": method,
        ...(params.uri ? { "Mcp-Name": params.uri } : {}),
      },
      connectionSignal,
    );
    if (!response.ok) {
      const Failure = response.status === 429 || response.status >= 500 ? RetryableTransportError : Error;
      throw new Failure("MCP " + method + " failed (" + response.status + "): " + (await response.text()));
    }
    return response;
  }
  async function read() {
    const response = await rpc("resources/read", { uri: outcomeUri }, signal);
    const message = await response.json();
    if (message.error) throw new Error(message.error.message);
    const outcome = JSON.parse(message.result.contents[0].text);
    if (!outcome.eventId) return false;
    return { conversationId, ...outcome };
  }
  let retryDelay = 100;
  while (!signal?.aborted) {
    const connection = new AbortController();
    const connectionSignal = signal ? AbortSignal.any([signal, connection.signal]) : connection.signal;
    let message;
    try {
      const response = await rpc(
        "subscriptions/listen",
        { notifications: { resourceSubscriptions: [outcomeUri] } },
        connectionSignal,
      );
      if (!response.headers.get("content-type")?.startsWith("text/event-stream"))
        throw new Error("MCP outcome subscriptions are unavailable: " + (await response.text()));
      let buffered = "";
      stream: for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
        buffered += chunk;
        let end;
        while ((end = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, end).trimEnd();
          buffered = buffered.slice(end + 1);
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5));
          if (event.error) throw new Error(event.error.message);
          if (
            event.method === "notifications/subscriptions/acknowledged" ||
            event.method === "notifications/resources/updated"
          ) {
            message = await read();
            if (message) break stream;
            retryDelay = 100;
          }
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof TypeError || error instanceof RetryableTransportError)) throw error;
    } finally {
      connection.abort();
    }
    if (message) {
      await deliver(message);
      return;
    }
    await delay(retryDelay, undefined, { signal });
    retryDelay = Math.min(5_000, retryDelay * 2);
  }
  signal?.throwIfAborted();
}
