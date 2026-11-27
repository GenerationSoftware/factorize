import type { HetznerCreateInput } from "../api/hetzner-contracts";
import { fetchWithoutRedirects, OutboundRedirectError } from "../../transport/http/fetch-without-redirects";
import { z } from "zod";

const origin = "https://api.hetzner.cloud";
const pageSize = 25;
const maxPages = 4;
export const provisionedSshUser = "factorize-agent";
const provisionLabel = "factorize-request";
const maxPageBytes = 512 * 1024;

const serverPage = z.object({
  servers: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(255),
    status: z.string().min(1).max(64),
    location: z.object({ name: z.string().min(1).max(64) }).nullish(),
  })).max(pageSize),
  meta: z.object({ pagination: z.object({ next_page: z.number().int().positive().nullable() }) }),
});

const provisionedServer = z.object({id: z.number().int().positive(), name: z.string(), labels: z.record(z.string(), z.string())});
const provisionResponse = z.object({server: provisionedServer});
const reconciliationResponse = z.object({servers: z.array(provisionedServer).max(2)});

const targetResponse = z.object({ server: z.object({
  id: z.number().int().positive(),
  public_net: z.object({ ipv4: z.object({ ip: z.ipv4() }).nullable() }),
}) });

export type HetznerFailure = "token_rejected" | "not_found" | "timeout" | "transport_error" | "rate_limited" | "upstream_error" | "unexpected_status" | "invalid_response";

export class HetznerCloudError extends Error {
  constructor(readonly kind: "auth" | "unavailable" | "invalid_response" | "not_found",
    readonly reason: HetznerFailure = kind === "auth" ? "token_rejected" : kind === "unavailable" ? "transport_error" : kind,
    readonly upstreamStatus?: number) {
    super(kind === "auth" ? "Hetzner rejected the project token." :
      kind === "invalid_response" ? "Hetzner returned an unexpected server inventory response." :
      kind === "not_found" ? "The server is unavailable in the connected Hetzner project." :
      "Hetzner server inventory is unavailable. Try again.");
    this.name = "HetznerCloudError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxPageBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new HetznerCloudError("invalid_response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HetznerCloudError("invalid_response");
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, json = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxPageBytes) throw new HetznerCloudError("invalid_response");
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new HetznerCloudError("invalid_response");
  } finally {
    reader.releaseLock();
  }
}

/** No caller-controlled origin, method, headers, or URL. */
export function createHetznerCloudClient(fetchImpl: typeof fetch = fetch) {
  async function request(url: URL, token: string, signal: AbortSignal, data?: unknown) {
    let response: Response;
    try {
      response = await fetchWithoutRedirects(url, {
        method: data === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(data === undefined ? {} : { "content-type": "application/json" }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal,
      }, fetchImpl);
    } catch (error) {
      if (error instanceof OutboundRedirectError) throw new HetznerCloudError("unavailable", "unexpected_status", error.status);
      throw new HetznerCloudError("unavailable", signal.aborted ? "timeout" : "transport_error");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const { status } = response;
      if (status === 401 || status === 403) throw new HetznerCloudError("auth", "token_rejected", status);
      if (status === 404) throw new HetznerCloudError("not_found", "not_found", status);
      throw new HetznerCloudError("unavailable", status === 429 ? "rate_limited" : status >= 500 ? "upstream_error" : "unexpected_status", status);
    }
    try { return await readJson(response); }
    catch (error) {
      if (signal.aborted) throw new HetznerCloudError("unavailable", "timeout", response.status);
      throw error;
    }
  }

  async function page(token: string, number: number, signal: AbortSignal) {
    const url = new URL("/v1/servers", origin);
    url.searchParams.set("page", String(number));
    url.searchParams.set("per_page", String(pageSize));
    const parsed = serverPage.safeParse(await request(url, token, signal));
    if (!parsed.success) throw new HetznerCloudError("invalid_response");
    const next = parsed.data.meta.pagination.next_page;
    if (next !== null && next !== number + 1) throw new HetznerCloudError("invalid_response");
    return {
      servers: parsed.data.servers.map(({ id, name, status, location }) => ({ id, name, status, location: location?.name ?? null })),
      next,
    };
  }
  return {
    // This validates access, not the provider-side token permission choice.
    async validate(token: string) { await page(token, 1, AbortSignal.timeout(5_000)); },
    async inventory(token: string) {
      const signal = AbortSignal.timeout(8_000);
      const servers = [];
      let next: number | null = 1;
      for (let count = 0; count < maxPages && next !== null; count++) {
        const result = await page(token, next, signal);
        servers.push(...result.servers);
        next = result.next;
      }
      return { servers, truncated: next !== null };
    },
    async create(token: string, input: HetznerCreateInput, ticket: string, publicKey: string) {
      // Do not pass ssh_keys to the API: the key belongs to a dedicated user, not root.
      const config = { disable_root: true, ssh_pwauth: false, allow_public_ssh_keys: false, ssh_genkeytypes: ["ed25519"], users: [{
        name: provisionedSshUser, shell: "/bin/sh", lock_passwd: true, sudo: null,
        ssh_authorized_keys: [`restrict,command="/bin/true" ${publicKey}`],
      }] };
      const body = { name: input.name, server_type: input.serverType, location: input.location, image: "ubuntu-24.04",
        start_after_create: true, public_net: { enable_ipv4: true, enable_ipv6: false },
        labels: { [provisionLabel]: ticket }, user_data: "#cloud-config\n" + JSON.stringify(config) + "\n" };
      const reply = provisionResponse.safeParse(await request(new URL("/v1/servers", origin), token, AbortSignal.timeout(8_000), body));
      const server = reply.success ? reply.data.server : null;
      if (!server || server.name !== input.name || server.labels[provisionLabel] !== ticket) throw new HetznerCloudError("invalid_response");
      return server.id;
    },
    async reconcile(token: string, name: string, ticket: string) {
      const url = new URL("/v1/servers", origin);
      url.searchParams.set("label_selector", `${provisionLabel}=${ticket}`);
      url.searchParams.set("name", name);
      url.searchParams.set("per_page", "2");
      const reply = reconciliationResponse.safeParse(await request(url, token, AbortSignal.timeout(5_000)));
      if (!reply.success || reply.data.servers.length > 1) throw new HetznerCloudError("invalid_response");
      const server = reply.data.servers[0];
      if (server && (server.name !== name || server.labels[provisionLabel] !== ticket)) throw new HetznerCloudError("invalid_response");
      return server?.id ?? null;
    },
    /** Internal provider lookup. IPs are never included in inventory responses. */
    async target(token: string, id: number) {
      if (!Number.isSafeInteger(id) || id < 1) throw new HetznerCloudError("not_found");
      const url = new URL(`/v1/servers/${id}`, origin);
      const result = targetResponse.safeParse(await request(url, token, AbortSignal.timeout(5_000)));
      if (!result.success || result.data.server.id !== id) throw new HetznerCloudError("invalid_response");
      const ipv4 = result.data.server.public_net.ipv4?.ip;
      if (!ipv4) throw new HetznerCloudError("not_found");
      return { id, ipv4 };
    },
  };
}
