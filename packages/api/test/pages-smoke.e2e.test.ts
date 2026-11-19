import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { loadingFixture } from "./helpers/loading-fixture";
import worker from "../src/worker";
import { ApiService } from "../src/flow-service";
import { ACCESS_SCOPES } from "../src/access-tokens";
import { deviceAuthorization } from "../src/device-oauth";
import { startConnection } from "../src/oauth-continuation";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {
  constructor(private options: any) {}
  fetch(request: Request, env: any, ctx: any) { return this.options.defaultHandler.fetch(request, env, ctx); }
}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));

// Run the built frontend against the actual Worker and an isolated PostgreSQL
// database. Only the Cloudflare runtime/OAuth SDK boundary is substituted;
// application JSON responses must come from the real endpoint implementations.
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("every page E2E smoke", () => {
  let f: Awaited<ReturnType<typeof loadingFixture>>, browser: Browser, skillId: string, deviceCode: string, authorizationPath: string, authorizationCookie: { name: string; value: string };
  beforeAll(async () => {
    f = await loadingFixture(process.env.AUTH_TEST_DATABASE_URL!);
    browser = await chromium.launch({ headless: true });
    const service = new ApiService(f.env, { ...f.auth, scopes: [...ACCESS_SCOPES] });
    skillId = (await service.createSkill({ key: "smoke_skill", body: "Smoke test instructions" })).id;
    // The provider SDK normally supplies this registered client and parses its
    // request. Consent validation/signing and device storage still run for real.
    Object.assign(f.env.OAUTH_PROVIDER!, {
      lookupClient: async () => ({ clientId: "smoke", clientName: "Smoke CLI", redirectUris: ["http://127.0.0.1/callback"], tokenEndpointAuthMethod: "none" }),
      parseAuthRequest: async () => ({ responseType: "code", clientId: "smoke", redirectUri: "http://127.0.0.1/callback", scope: ["flows:read"], state: "smoke", codeChallenge: "smoke-challenge", codeChallengeMethod: "S256", resource: f.env.APP_ORIGIN + "/mcp", issuer: f.env.APP_ORIGIN }),
    });
    const destination = "/authorize?" + new URLSearchParams({ client_id: "smoke", response_type: "code", redirect_uri: "http://127.0.0.1/callback", code_challenge: "smoke-challenge", code_challenge_method: "S256" });
    const connection = await startConnection(new Request(f.env.APP_ORIGIN + destination), f.env, destination);
    expect(connection).not.toBeNull();
    const authorization = new URL(destination, f.env.APP_ORIGIN);
    authorization.searchParams.set("connection", connection!.connection);
    authorizationPath = authorization.pathname + authorization.search;
    const [name, value] = connection!.cookie.split(";")[0].split("=");
    authorizationCookie = { name, value };
    const issued = await deviceAuthorization(new Request(f.env.APP_ORIGIN + "/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: "smoke", scope: "flows:read" }) }), f.env, f.env.OAUTH_PROVIDER! as any, ["flows:read"]);
    expect(issued.status).toBe(200);
    deviceCode = (await issued.json() as any).user_code;
  });
  afterAll(async () => { await browser?.close(); await f?.cleanup(); });

  type SmokePage = { path: () => string; ready: (page: Page) => Promise<unknown>; anonymous?: boolean; destination?: () => string };
  const heading = (name: string) => (page: Page) => page.getByRole("heading", { name, exact: true }).waitFor();
  const label = (name: string) => (page: Page) => page.getByLabel(name, { exact: true }).waitFor();
  const job = () => `/jobs/${f.jobIds[0]}`;
  const project = () => `/projects/${f.projectId}`;
  const run = () => `/job-runs/${f.runId}`;
  const info = (page: Page) => page.getByText("Prompt, context and provenance", { exact: true }).waitFor();
  const pages: Record<string, SmokePage> = {
    "not found": { path: () => "/missing-smoke-page", ready: heading("Page not found") },
    "home": { path: () => "/", ready: heading("Recent work") },
    "welcome": { path: () => "/", ready: heading("Welcome to Factorize"), anonymous: true },
    "projects": { path: () => "/projects", ready: heading("Projects") },
    "create project": { path: () => "/projects/new", ready: label("Name") },
    "project": { path: project, ready: page => page.getByRole("group", { name: "Project view" }).waitFor() },
    "project runs": { path: () => project() + "/runs", ready: heading("Project runs") },
    "project settings": { path: () => project() + "/settings", ready: label("Name") },
    "jobs": { path: () => "/jobs", ready: heading("Jobs") },
    "create job": { path: () => "/jobs/new", ready: label("Name") },
    "job": { path: job, ready: page => page.getByRole("group", { name: "Job actions" }).waitFor() },
    "legacy job edit": { path: () => job() + "/edit", destination: () => job() + "/settings/general", ready: label("Name") },
    "job settings": { path: () => job() + "/settings", destination: () => job() + "/settings/general", ready: label("Name") },
    "job general": { path: () => job() + "/settings/general", ready: label("Name") },
    "job execution": { path: () => job() + "/settings/execution", ready: page => page.getByRole("combobox", { name: /^Execution type/ }).waitFor() },
    "job context": { path: () => job() + "/settings/context", ready: label("Prompt template") },
    "job permissions": { path: () => job() + "/settings/permissions", ready: heading("Manual invocation permissions") },
    "job triggers": { path: () => job() + "/settings/triggers", ready: heading("Triggers") },
    "runs": { path: () => "/job-runs", ready: heading("Job Runs") },
    "run": { path: run, ready: heading("Trace") },
    "full trace": { path: () => run() + "/trace", ready: heading("Full trace") },
    "run info": { path: () => run() + "/info", ready: info },
    "legacy run context": { path: () => run() + "/context", destination: () => run() + "/info", ready: info },
    "legacy run settings": { path: () => run() + "/settings", destination: () => run() + "/info", ready: info },
    "settings": { path: () => "/settings", ready: heading("Your integrations") },
    "integrations": { path: () => "/settings/integrations", ready: heading("Available integrations") },
    "API keys": { path: () => "/settings/api-keys", ready: heading("API keys") },
    "create API key": { path: () => "/settings/api-keys/new", ready: label("Key name") },
    "authorized clients": { path: () => "/settings/authorized-clients", ready: heading("Authorized clients") },
    "password": { path: () => "/settings/password", ready: label("Current password") },
    "skills": { path: () => "/skills", ready: heading("smoke_skill") },
    "skill": { path: () => `/skills/${skillId}`, ready: heading("Instructions") },
    "login": { path: () => "/auth/login", ready: label("Password"), anonymous: true },
    "signup": { path: () => "/auth/signup", ready: label("New password"), anonymous: true },
    "password reset request": { path: () => "/auth/password-reset", ready: label("Email"), anonymous: true },
    "password reset completion": { path: () => "/auth/password-reset?token=smoke", ready: label("New password"), anonymous: true },
    "verify email": { path: () => "/auth/verify?token=smoke", ready: heading("Verify your email"), anonymous: true },
    "resend verification": { path: () => "/auth/verify/request", ready: label("Email"), anonymous: true },
    "authorize client": { path: () => authorizationPath, ready: heading("Authorize Smoke CLI") },
    "device code entry": { path: () => "/device", ready: label("Device code") },
    "device approval": { path: () => `/device?user_code=${deviceCode}`, ready: heading("Authorize Smoke CLI") },
  };

  for (const [name, smoke] of Object.entries(pages)) it(`loads ${name} without runtime or API errors`, async () => {
    // A fresh browser context tests direct links with no warm query cache.
    const context = await browser.newContext();
    const failures: string[] = [];
    try {
      if (!smoke.anonymous) await context.addCookies([{ name: "factorize_session", value: f.cookie.slice("factorize_session=".length), domain: "factorize.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      if (smoke.path().startsWith("/authorize")) await context.addCookies([{ ...authorizationCookie, domain: "factorize.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      await context.route("**/*", async route => {
        const request = route.request();
        const response = await worker.fetch(new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData()! } : {}) }), f.env, { waitUntil() {} } as any).catch(error => {
          failures.push(String(error));
          return new Response("Request failed", { status: 500 });
        });
        if (response.status >= 400) failures.push(`${request.method()} ${new URL(request.url()).pathname}: ${response.status}`);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on("pageerror", error => failures.push(error.message));
      // React can catch rendering exceptions before they reach pageerror.
      page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
      await page.goto(f.env.APP_ORIGIN + smoke.path());
      await smoke.ready(page);
      // Wait for page queries to render, including children that load after
      // the page shell. Polling traces intentionally never become network-idle.
      await expect.poll(async () => page.getByRole("status").filter({ hasText: /^(Loading|Validating)/ }).count(), { timeout: 5000 }).toBe(0);
      expect(new URL(page.url()).pathname).toBe(new URL(smoke.destination?.() ?? smoke.path(), f.env.APP_ORIGIN).pathname);
      expect(await page.getByRole("heading", { name: "Could not load this page", exact: true }).count()).toBe(0);
      expect(await page.getByRole("alert").allTextContents()).toEqual([]);
      expect(failures).toEqual([]);
    } finally { await context.close(); }
  });
});
