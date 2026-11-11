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

/** Read the current user-encrypted integration records selected by an active run.
 * The control plane decrypts only Factorize's outer encryption layer. */
export async function readProxyIntegrationSnapshot({ controlOrigin, token, binding, fetchImpl = fetch } = {}) {
  if (!binding || !uuidPattern.test(binding.runId ?? "") || !Number.isSafeInteger(binding.grantRevision) || binding.grantRevision < 0) {
    throw new TypeError("invalid proxy integration snapshot binding");
  }
  const result = await proxyControlRequest({
    controlOrigin,
    token,
    path: "/internal/credential-proxy/integration-snapshot",
    body: { runId: binding.runId, grantRevision: binding.grantRevision },
    fetchImpl,
  });
  const modelAccount = result?.modelAccount;
  if (typeof result?.ownerId !== "string" || !Array.isArray(result.records)
      || result.records.some(record => !record || typeof record.id !== "string" || record.kind !== "bearer"
        || typeof record.origin !== "string" || typeof record.encryptedPayload !== "string" || !Number.isSafeInteger(record.revision))
      || !(modelAccount === null || (modelAccount && typeof modelAccount.id === "string" && modelAccount.kind === "model"
        && modelAccount.origin === null && typeof modelAccount.encryptedPayload === "string" && Number.isSafeInteger(modelAccount.revision)))) {
    throw new Error("invalid proxy integration snapshot response");
  }
  return result;
}

/** Read durable revocations for the registered proxy boot. Replaying the full
 * set is intentional: it closes runs revoked while this proxy was offline and
 * runtime.revokeRun is idempotent. */
export async function readProxyRunRevocations({ controlOrigin, token, bootEpoch, fetchImpl = fetch } = {}) {
  if (!bootEpochPattern.test(bootEpoch ?? "")) throw new TypeError("invalid proxy boot epoch");
  const result = await proxyControlRequest({
    controlOrigin,
    token,
    path: "/internal/credential-proxy/revocations",
    body: { bootEpoch },
    fetchImpl,
  });
  if (!Array.isArray(result?.revokedRunIds) || result.revokedRunIds.some(id => !uuidPattern.test(id))) {
    throw new Error("invalid proxy revocation response");
  }
  return result.revokedRunIds;
}

/** Poll durable control-plane state. A failed request leaves established
 * connections running and the next bounded poll retries when communication
 * recovers; it does not add an authorization lease or expiry. */
export function startProxyRunRevocationMonitor({ controlOrigin, controlCredential, bootEpoch, runtime, intervalMs = 5_000, fetchImpl = fetch } = {}) {
  if (!runtime || typeof runtime.revokeRun !== "function" || !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) {
    throw new TypeError("invalid proxy revocation monitor configuration");
  }
  let stopped = false;
  let timer;
  let polling;
  const poll = async () => {
    if (stopped || polling) return;
    polling = (async () => {
      try {
        const runIds = await readProxyRunRevocations({ controlOrigin, token: controlCredential, bootEpoch, fetchImpl });
        for (const runId of runIds) await runtime.revokeRun(runId);
      } catch {
        // Keep existing connections alive during an outage and retry on schedule.
      } finally {
        polling = undefined;
        if (!stopped) timer = setTimeout(poll, intervalMs);
      }
    })();
  };
  void poll();
  return Object.freeze({
    async close() {
      stopped = true;
      clearTimeout(timer);
      await polling;
    },
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create the proxy-side half of enrollment. The job VM supplies only its run
 * ID over the already authenticated TLS connection; the proxy derives VM and
 * boot identity locally, then issues and consumes a fresh one-use enrollment
 * using its private control credential. Integration secrets stay in the
 * proxy's local grant resolver and never cross this control API.
 */
export function createProxyEnrollmentAuthenticator({ controlOrigin, controlCredential, bootEpoch, resolveGrants, fetchImpl = fetch } = {}) {
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(controlCredential ?? "")) throw new TypeError("invalid proxy control credential");
  if (!bootEpochPattern.test(bootEpoch ?? "")) throw new TypeError("invalid proxy boot epoch");
  if (typeof resolveGrants !== "function") throw new TypeError("proxy enrollment requires a local grant resolver");
  validateOrigin(controlOrigin);
  let credential = controlCredential;
  return async function authenticateRun({ runId, vmIdentity, runCredential, bootEpoch: requestedBootEpoch }) {
    if (!uuidPattern.test(runId ?? "") || typeof vmIdentity !== "string" || !vmIdentity.trim() || vmIdentity.length > 255
        || !/^fzt_run_[A-Za-z0-9_-]{43,200}$/.test(runCredential ?? "") || requestedBootEpoch !== bootEpoch) throw new Error("invalid proxy enrollment identity");
    const options = { controlOrigin, token: credential, fetchImpl };
    const requested = { runId, vmIdentity, runCredential };
    const enrollment = await issueProxyEnrollment({ ...options, body: requested });
    const binding = await consumeProxyEnrollment({ ...options, body: { runId, vmIdentity, enrollmentToken: enrollment.token } });
    if (binding.runId !== runId || binding.vmIdentity !== vmIdentity || binding.bootEpoch !== bootEpoch
        || typeof binding.tenantId !== "string" || typeof binding.proxyIdentity !== "string"
        || binding.enrollmentId !== enrollment.enrollmentId || binding.grantRevision !== enrollment.grantRevision) {
      throw new Error("consumed enrollment binding did not match the authenticated connection");
    }
    const grants = await resolveGrants(binding);
    if (!Array.isArray(grants)) throw new Error("proxy grants are unavailable");
    return {
      authenticated: true,
      enrollmentConsumed: true,
      connectionId: binding.enrollmentId,
      runId: binding.runId,
      vmId: binding.vmIdentity,
      vmIdentity: binding.vmIdentity,
      bootEpoch: binding.bootEpoch,
      tenantId: binding.tenantId,
      proxyIdentity: binding.proxyIdentity,
      grantRevision: binding.grantRevision,
      grants,
    };
  };
}
