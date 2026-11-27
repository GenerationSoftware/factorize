import { expect, it } from "vitest";
import { appConfig, githubConfig, signingConfig } from "../src/config/runtime";
import { proxyLimits, subscriptionLimits } from "../src/config/limits";

it("projects only the requested configuration without enabling unconfigured providers", () => {
  const env = {
    APP_ORIGIN: "https://fixture.example",
    SESSION_SIGNING_SECRET: "fixture-session",
    CREDENTIAL_ENCRYPTION_KEY: "fixture-encryption",
  };
  expect(appConfig(env)).toEqual({ origin: "https://fixture.example", marketingOrigin: undefined });
  expect(githubConfig({})).toMatchObject({ appId: undefined, privateKey: undefined });
  expect(signingConfig(env)).toEqual({
    sessionSecret: "fixture-session", credentialKey: "fixture-encryption", totpKey: undefined,
  });
  expect(proxyLimits.responseBytes).toBe(64 * 1024 * 1024);
  expect(subscriptionLimits.maxRecoveryAttempts).toBe(4);
});
