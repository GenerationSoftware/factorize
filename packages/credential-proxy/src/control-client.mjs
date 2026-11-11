const bootEpochPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Register one proxy process boot using a provisioning-scoped credential. The token is only held in this call's memory. */
function validateOrigin(controlOrigin) {
  const origin = new URL(controlOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new TypeError("proxy control origin must be an HTTPS origin");
  return origin;
}

export async function registerProxyBoot({ controlOrigin, token, bootEpoch, fetchImpl = fetch }) {
  const origin = validateOrigin(controlOrigin);
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
    if (result?.registered !== true || result.bootEpoch !== bootEpoch || typeof result.proxyIdentity !== "string" || !/^fzc_[A-Za-z0-9_-]{43}$/.test(result.controlCredential ?? "")) throw new Error("invalid proxy boot registration response");
    return { proxyIdentity: result.proxyIdentity, bootEpoch: result.bootEpoch, controlCredential: result.controlCredential };
  } finally {
    credential = "";
  }
}

async function proxyControlRequest({ controlOrigin, token, path, body, fetchImpl }) {
  const origin = validateOrigin(controlOrigin);
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(token ?? "")) throw new TypeError("invalid proxy control credential");
  const response = await fetchImpl(new URL(path, origin), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  if (!response.ok) throw new Error("proxy control request rejected");
  return response.json();
}

export async function issueProxyEnrollment(options) {
  const result = await proxyControlRequest({ ...options, path: "/internal/credential-proxy/enroll" });
  if (typeof result?.token !== "string" || typeof result?.enrollmentId !== "string" || !Number.isSafeInteger(result?.grantRevision)) throw new Error("invalid proxy enrollment response");
  return result;
}

export async function consumeProxyEnrollment(options) {
  const result = await proxyControlRequest({ ...options, path: "/internal/credential-proxy/consume-enrollment" });
  if (result?.consumed !== true || typeof result?.binding?.enrollmentId !== "string") throw new Error("invalid consumed enrollment response");
  return result.binding;
}
