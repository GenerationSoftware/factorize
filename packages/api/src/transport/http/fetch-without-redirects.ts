export class OutboundRedirectError extends Error {
  constructor(readonly status: number) {
    super("The upstream service returned a redirect.");
  }
}

/** Never send credentials or replay a request at an upstream Location.
 * Workers does not implement the error mode and defaults to "follow"
 * when constructing an outbound Request. Override even a signed Request. */
export async function fetchWithoutRedirects(input: RequestInfo | URL, init?: Omit<RequestInit, "redirect">, fetcher: typeof fetch = fetch): Promise<Response> {
  const response = await fetcher(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => {});
    throw new OutboundRedirectError(response.status);
  }
  return response;
}
