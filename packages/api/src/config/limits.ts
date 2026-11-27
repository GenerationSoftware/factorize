/** Internal defaults are not new deployment settings. Keep protocol limits stable. */
export const proxyLimits = {
  requestBytes: 32 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024,
  timeoutMs: 15 * 60_000,
  artifactBlockBytes: 1024 * 1024,
} as const;

export const subscriptionLimits = {
  defaultLifetimeMs: 24 * 60 * 60 * 1000,
  maxLifetimeMs: 7 * 24 * 60 * 60 * 1000,
  maxDeliveryAttempts: 5,
  maxRecoveryAttempts: 4,
  retryIntervalMs: 15_000,
} as const;
