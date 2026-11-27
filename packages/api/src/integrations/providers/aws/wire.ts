export class AwsUpstreamError extends Error {
  constructor(readonly kind: "trust" | "denied" | "upstream") { super("AWS integration request failed."); }
}

async function* awsTextChunks(response: Response, byteLimit: number) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > byteLimit) throw new AwsUpstreamError("upstream");
      yield decoder.decode(value, { stream: true });
    }
    yield decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function awsResponseText(response: Response, byteLimit: number) {
  let value = "";
  for await (const chunk of awsTextChunks(response, byteLimit)) value += chunk;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export const record = (value: unknown) => isRecord(value) ? value : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export async function awsMcpReply(response: Response, id: number): Promise<Record<string, unknown>> {
  const bound = 192 * 1024;
  const type = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  const matches = (reply: unknown): reply is Record<string, unknown> => isRecord(reply) && reply.jsonrpc === "2.0" && reply.id === id;
  if (type === "application/json") {
    const reply = JSON.parse(await awsResponseText(response, bound));
    if (matches(reply)) return reply;
  } else if (type === "text/event-stream") {
    // Dispatch on complete SSE records, not on transport chunks. Stop reading as
    // soon as the matching JSON-RPC response arrives, even if the server stays open.
    let pending = "";
    for await (const chunk of awsTextChunks(response, bound)) {
      pending += chunk;
      for (let separator = /\r?\n\r?\n/.exec(pending); separator; separator = /\r?\n\r?\n/.exec(pending)) {
        const data = pending.slice(0, separator.index).split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        pending = pending.slice(separator.index + separator[0].length);
        if (!data) continue;
        let reply: unknown;
        try { reply = JSON.parse(data); } catch { throw new AwsUpstreamError("upstream"); }
        if (matches(reply)) return reply;
      }
    }
  }
  throw new AwsUpstreamError("upstream");
}
