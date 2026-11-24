import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

const apiSession = { authenticated: true, user: { id: "owner", email: "owner@example.test" },
  team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [] };
const recovery = Array.from({ length: 10 }, (_, i) => "saved-recovery-code-" + i);

test("sets up an authenticator locally, then shows the recovery codes only once", async ({ page, origin }) => {
  let enabled = false;
  await page.route("**/api/v1/session", route => route.fulfill({ json: apiSession }));
  await page.route("**/api/v1/auth/two-factor", route => route.fulfill({ json: { enabled, available: true, method: "password", googleVerified: false } }));
  await page.route("**/api/v1/auth/two-factor/enrollment", route => {
    expect(route.request().postDataJSON()).toEqual({ password: "existing fixture password" });
    return route.fulfill({ json: { secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://totp/Factorize:owner?secret=ABCDEFGHIJKLMNOP&issuer=Factorize" } });
  });
  await page.route("**/api/v1/auth/two-factor/enable", route => {
    expect(route.request().postDataJSON()).toEqual({ code: "123456" });
    enabled = true;
    return route.fulfill({ json: { ok: true, recoveryCodes: recovery } });
  });
  await page.goto(origin + "/settings/two-factor");
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  await page.getByLabel("Current password").fill("existing fixture password");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toBeVisible();
  await expect(page.getByText("ABCDEFGHIJKLMNOP")).toBeVisible();
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Enable two-factor authentication" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  for (const code of recovery) await expect(page.getByText(code, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I saved my codes" }).click();
  await expect(page.getByText(recovery[0])).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Disable two-factor authentication" })).toBeVisible();
  await expect(page.getByText(recovery[0])).toHaveCount(0);
});

test("sign-in prompts for a second factor before reaching the original destination", async ({ page, origin }) => {
  let signed = false;
  await page.route("**/api/v1/session", route => route.fulfill({ json: signed ? apiSession : { authenticated: false } }));
  await page.route("**/api/v1/auth/login", route => route.fulfill({ json: { ok: true, returnTo: "/auth/two-factor" } }));
  await page.route("**/api/v1/auth/two-factor/challenge", route => {
    expect(route.request().postDataJSON()).toEqual({ code: "fixture-recovery-code" });
    signed = true;
    return route.fulfill({ json: { ok: true, returnTo: "/settings/two-factor" } });
  });
  await page.route("**/api/v1/auth/two-factor", route => route.fulfill({ json: { enabled: true, available: true, method: "password", googleVerified: false } }));
  await page.goto(origin + "/auth/login");
  await page.getByLabel("Username or email").fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("existing fixture password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finish signing in" })).toBeVisible();
  expect(signed).toBe(false);
  await page.getByLabel("Authenticator or recovery code").fill("fixture-recovery-code");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(origin + "/settings/two-factor");
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible();
});
