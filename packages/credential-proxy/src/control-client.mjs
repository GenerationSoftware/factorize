const bootEpochPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Register one proxy process boot using a provisioning-scoped credential. The token is only held in this call's memory. */
function validateOrigin(controlOrigin) {
  const origin = new URL(controlOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new TypeError("proxy control origin must be an HTTPS origin");
  return origin;
}

export async function registerProxyBoot({ controlOrigin, token, bootEpoch, browserOrigin, fetchImpl = fetch }) {
  const origin = validateOrigin(controlOrigin);
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(token ?? "")) throw new TypeError("invalid proxy control credential");
  if (!bootEpochPattern.test(bootEpoch ?? "")) throw new TypeError("invalid proxy boot epoch");
  const browser = new URL(browserOrigin);
  if (browser.protocol !== "https:" || browser.origin !== browserOrigin || browser.username || browser.password) throw new TypeError("invalid browser control origin");
  let credential = token;
  try {
    const response = await fetchImpl(new URL("/internal/credential-proxy/register-boot", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ bootEpoch, browserOrigin }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("proxy boot registration rejected");
    const result = await response.json();
    if (result?.registered !== true || result.bootEpoch !== bootEpoch || typeof result.proxyIdentity !== "string"
        || !uuidPattern.test(result.tenantId ?? "") || !/^fzc_[A-Za-z0-9_-]{43}$/.test(result.controlCredential ?? "")) throw new Error("invalid proxy boot registration response");
    return { tenantId: result.tenantId, proxyIdentity: result.proxyIdentity, bootEpoch: result.bootEpoch, controlCredential: result.controlCredential };
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
  if (!response.ok) {
    let code;
    try { code = (await response.clone().json())?.error; } catch { /* Keep error handling bounded to the HTTP status. */ }
    const error = new Error("proxy control request rejected");
    error.name = "ProxyControlRequestError";
    error.status = response.status;
    if (typeof code === "string") error.code = code;
    throw error;
  }
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

export async function reportProxyRuntimeStatus({ controlOrigin, token, bootEpoch, unlocked, fetchImpl = fetch } = {}) {
  if (!bootEpochPattern.test(bootEpoch ?? "") || typeof unlocked !== "boolean") throw new TypeError("invalid proxy runtime status");
  const result = await proxyControlRequest({ controlOrigin, token, path: "/internal/credential-proxy/status", body: { bootEpoch, unlocked }, fetchImpl });
  if (result?.updated !== true) throw new Error("invalid proxy runtime status response");
  return result;
}

export function startProxyRuntimeStatusReporter({ controlOrigin, token, bootEpoch, runtime, intervalMs = 10_000, fetchImpl = fetch } = {}) {
  if (!runtime || typeof runtime.state !== "string" || !Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new TypeError("invalid proxy runtime status reporter");
  }
  let closed = false, pending = Promise.resolve();
  const report = () => {
    if (closed) return;
    pending = pending.then(() => reportProxyRuntimeStatus({ controlOrigin, token, bootEpoch, unlocked: runtime.state === "unlocked", fetchImpl })).catch(() => {});
  };
  report();
  const timer = setInterval(report, intervalMs);
  timer.unref?.();
  return { async close() { closed = true; clearInterval(timer); await pending; } };
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
        || !(record.deletedAt != null && record.encryptedPayload === null
          || typeof record.origin === "string" && typeof record.encryptedPayload === "string") || !Number.isSafeInteger(record.revision))
      || !(modelAccount === null || (modelAccount && typeof modelAccount.id === "string" && modelAccount.kind === "model"
        && modelAccount.origin === null && typeof modelAccount.encryptedPayload === "string" && Number.isSafeInteger(modelAccount.revision)))) {
    throw new Error("invalid proxy integration snapshot response");
  }
  return result;
}

/** Concrete proxy-side adapters for revision-bound encrypted model caches. */
export function createModelAccountPersistenceAdapter({ controlOrigin, controlCredential, ownerId, fetchImpl = fetch } = {}) {
  if (typeof ownerId !== "string" || !ownerId || !/^fzc_[A-Za-z0-9_-]{43}$/.test(controlCredential ?? "")) {
    throw new TypeError("model account persistence requires the registered proxy identity");
  }
  const read = async accountId => {
    if (!uuidPattern.test(accountId ?? "")) throw new TypeError("invalid model account id");
    const result = await proxyControlRequest({ controlOrigin, token: controlCredential, path: "/internal/credential-proxy/model-account-cache", body: { operation: "read", accountId }, fetchImpl });
    const account = result?.account;
    if (result?.ownerId !== ownerId || !account || account.id !== accountId || account.kind !== "model"
        || account.origin !== null || typeof account.encryptedPayload !== "string"
        || !Number.isSafeInteger(account.revision) || !uuidPattern.test(account.keyGeneration ?? "")) {
      throw new Error("invalid model account persistence response");
    }
    return { ...account, ownerId };
  };
  return Object.freeze({
    async listAccounts() {
      const result = await proxyControlRequest({ controlOrigin, token: controlCredential, path: "/internal/credential-proxy/model-account-cache", body: { operation: "list" }, fetchImpl });
      if (result?.ownerId !== ownerId || !Array.isArray(result.accounts)
          || !uuidPattern.test(result.keyGeneration ?? "")
          || result.accounts.some(account => !account || !uuidPattern.test(account.id ?? "") || account.kind !== "model"
            || account.origin !== null || !Number.isSafeInteger(account.revision))) {
        throw new Error("invalid model account list response");
      }
      return result.accounts.map(account => ({ ...account, ownerId, keyGeneration: result.keyGeneration }));
    },
    getAccount: read,
    async getEncryptedCache(accountId) {
      const account = await read(accountId);
      return { accountId, ownerId, keyGeneration: account.keyGeneration, revision: account.revision, encryptedPayload: account.encryptedPayload };
    },
    async persistEncrypted({ id, expectedRevision, encryptedPayload, idempotencyKey }) {
      if (!uuidPattern.test(id ?? "") || !uuidPattern.test(idempotencyKey ?? "") || !Number.isSafeInteger(expectedRevision)
          || typeof encryptedPayload !== "string" || encryptedPayload.length > 65_536) throw new TypeError("invalid encrypted model account update");
      const result = await proxyControlRequest({ controlOrigin, token: controlCredential, path: "/internal/credential-proxy/model-account-cache",
        body: { operation: "save", accountId: id, expectedRevision, encryptedPayload, idempotencyKey }, fetchImpl });
      if (result?.accountId !== id || result.revision !== expectedRevision + 1 || typeof result.duplicate !== "boolean") {
        throw new Error("invalid model account persistence response");
      }
      return result;
    },
  });
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
export function startProxyRunRevocationMonitor({ controlOrigin, controlCredential, bootEpoch, runtime, onRevoked = () => {}, intervalMs = 5_000, fetchImpl = fetch } = {}) {
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
        for (const runId of runIds) { await runtime.revokeRun(runId); await onRevoked(runId); }
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
export function createProxyEnrollmentAuthenticator({ controlOrigin, controlCredential, bootEpoch, resolveGrants, resolveRunCredential, fetchImpl = fetch } = {}) {
  if (!/^fzc_[A-Za-z0-9_-]{43}$/.test(controlCredential ?? "")) throw new TypeError("invalid proxy control credential");
  if (!bootEpochPattern.test(bootEpoch ?? "")) throw new TypeError("invalid proxy boot epoch");
  if (typeof resolveGrants !== "function" || typeof resolveRunCredential !== "function") throw new TypeError("proxy enrollment requires local grant and run credential resolvers");
  validateOrigin(controlOrigin);
  let credential = controlCredential;
  return async function authenticateRun({ runId, vmIdentity, bootEpoch: requestedBootEpoch }) {
    if (!uuidPattern.test(runId ?? "") || typeof vmIdentity !== "string" || !vmIdentity.trim() || vmIdentity.length > 255
        || requestedBootEpoch !== bootEpoch) throw new Error("invalid proxy enrollment identity");
    const runCredential = resolveRunCredential(runId, vmIdentity);
    if (!/^fzt_run_[A-Za-z0-9_-]+_[A-Za-z0-9_-]{43}$/.test(runCredential ?? "")) throw new Error("run credential is unavailable for this VM");
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
      refreshGrants: () => resolveGrants(binding),
    };
  };
}
