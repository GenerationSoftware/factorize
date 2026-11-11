const bootEpochPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Register one proxy process boot using a provisioning-scoped credential. The token is only held in this call's memory. */
export async function registerProxyBoot({ controlOrigin, token, bootEpoch, fetchImpl = fetch }) {
  const origin = new URL(controlOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new TypeError("proxy control origin must be an HTTPS origin");
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(token ?? "")) throw new TypeError("invalid proxy control credential");
  if (!bootEpochPattern.test(bootEpoch ?? "")) throw new TypeError("invalid proxy boot epoch");
  let credential = token;
  try {
    const response = await fetchImpl(new URL("/internal/credential-proxy/register-boot", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ bootEpoch }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("proxy boot registration rejected");
    const result = await response.json();
    if (result?.registered !== true || result.bootEpoch !== bootEpoch || typeof result.proxyIdentity !== "string") throw new Error("invalid proxy boot registration response");
    return { proxyIdentity: result.proxyIdentity, bootEpoch: result.bootEpoch };
  } finally {
    credential = "";
  }
}
