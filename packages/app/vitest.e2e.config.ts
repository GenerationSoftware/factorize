import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/device-oauth.e2e.test.ts", "test/fresh-namespace.e2e.test.ts", "test/exe-run-lifecycle.e2e.test.ts"],
    poolOptions: {
      workers: {
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            SESSION_SIGNING_SECRET: "e2e-session-secret",
            CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            LINEAR_CLIENT_ID: "e2e-linear-client",
            LINEAR_CLIENT_SECRET: "e2e-linear-secret",
            LINEAR_WEBHOOK_SIGNING_SECRET: "e2e-webhook-secret",
          },
        },
      },
    },
  },
});
