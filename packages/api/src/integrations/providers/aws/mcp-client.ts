import { fetchWithoutRedirects } from "../../../transport/http/fetch-without-redirects";
import { AwsClient } from "aws4fetch";
import type { AwsRegion } from "./policy";
import { awsDeadline, type AwsCredentials } from "./sts";
import { array, awsMcpReply, AwsUpstreamError, record } from "./wire";

const initialProtocol = "2025-03-26";
const protocols = new Set([initialProtocol, "2025-06-18", "2025-11-25"]);

export type AwsScriptResult = { status: "completed" | "working"; result: unknown; stdout?: string };
export async function runAwsScript(credentials: AwsCredentials, region: AwsRegion, code: string, authorize: () => Promise<void>, signal?: AbortSignal): Promise<AwsScriptResult> {
  const endpoint = `https://aws-mcp.${region}.api.aws/mcp`;
  const signer = new AwsClient({ ...credentials, region, service: "aws-mcp", retries: 0 });
  const rpcSignal = awsDeadline(35_000, signal);
  let session: string | null = null;
  let protocol: string | null = null;
  async function send(payload?: object, deadline = rpcSignal) {
    const headers = new Headers({ accept: "application/json, text/event-stream" });
    if (payload) headers.set("content-type", "application/json");
    if (session) headers.set("mcp-session-id", session);
    if (protocol) headers.set("mcp-protocol-version", protocol);
    const request = await signer.sign(endpoint, {
      method: payload ? "POST" : "DELETE", headers, body: payload ? JSON.stringify(payload) : undefined,
      signal: deadline, aws: { allHeaders: true },
    });
    const response = await fetchWithoutRedirects(request);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new AwsUpstreamError([401, 403].includes(response.status) ? "denied" : "upstream");
    }
    return response;
  }
  try {
    const response = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: initialProtocol, capabilities: {}, clientInfo: { name: "Factorize", version: "1.0.0" },
    } });
    session = response.headers.get("mcp-session-id");
    if (session && !/^[!-~]{1,512}$/.test(session)) {
      session = null;
      void response.body?.cancel().catch(() => {});
      throw new AwsUpstreamError("upstream");
    }
    const hello = await awsMcpReply(response, 1);
    const version = record(hello.result).protocolVersion;
    if (hello.error || typeof version !== "string" || !protocols.has(version)) throw new AwsUpstreamError("upstream");
    protocol = version;
    const initialized = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    void initialized.body?.cancel().catch(() => {});

    // Recheck at the last possible point before dispatching code that may
    // perform writes. Do not replay a call after a timeout or transport error.
    await authorize();
    const reply = await awsMcpReply(await send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "aws___run_script", arguments: { code },
    } }), 2);
    const tool = record(reply.result);
    const content = array(tool.content);
    const envelopes = [record(tool.structuredContent), ...content.filter(item => record(item).type === "text").map(item => {
      const text = record(item).text;
      if (typeof text !== "string") return {};
      try { return record(JSON.parse(text)); } catch { return {}; }
    })];
    // Classify known denial markers for the caller, never expose upstream text.
    const denied = /AccessDenied|UnauthorizedOperation|not authorized to perform|forbidden/i;
    const errorEnvelopes = envelopes.filter(item => item.status === "error");
    const failure = reply.error || tool.isError === true || errorEnvelopes.length > 0;
    if (failure && denied.test(JSON.stringify({ error: reply.error, content: tool.isError ? content : undefined, errorEnvelopes }))) throw new AwsUpstreamError("denied");
    if (failure) throw new AwsUpstreamError("upstream");
    const value = envelopes.find(item => Object.hasOwn(item, "return_value") || item.status === "working");
    if (!value) throw new AwsUpstreamError("upstream");
    // Only the script result and stdout cross back to the client, not stream
    // metadata, upstream error internals, or the credential exchange response.
    const output: AwsScriptResult = { status: value.status === "working" ? "working" : "completed", result: value.return_value ?? null };
    if (typeof value.stdout === "string") output.stdout = value.stdout;
    let serialized = JSON.stringify(output);
    for (const secret of [credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken]) {
      serialized = serialized.replaceAll(secret, "[redacted]");
    }
    return JSON.parse(serialized) as AwsScriptResult;
  } finally {
    if (session && !signal?.aborted) {
      try { const closed = await send(undefined, awsDeadline(1_500, signal)); void closed.body?.cancel().catch(() => {}); }
      catch { /* A failed cleanup must not hide a result or trigger a replay. */ }
    }
  }
}
