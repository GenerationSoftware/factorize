import { expect } from "@playwright/test";
import { test } from "./fixtures.mjs";

test("Google signup checks the current username and handles a conflict on submit", async ({ page, origin }) => {
  const names = [];
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/v1/auth/google/pending", route => route.fulfill({ json: { email: "new@gmail.com", mode: "signup" } }));
  await page.route("**/api/v1/auth/google/username", route => {
    const { username } = route.request().postDataJSON();
    names.push(username);
    return route.fulfill({ json: { available: username !== "already-taken" } });
  });
  await page.route("**/api/v1/auth/google/finish", route => route.fulfill({
    status: 409, json: { error: { code: "invalid_request", message: "That username is already taken." } },
  }));
  await page.goto(origin + "/auth/google");
  await expect(page.getByRole("heading", { name: "Choose your Factorize username" })).toBeVisible();
  const username = page.getByRole("textbox", { name: "Username" });
  await username.fill("new");
  await username.fill("already-taken");
  await expect(page.getByText("That username is already taken.")).toBeVisible();
  expect(names).toEqual(["already-taken"]);
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  await username.fill("free-name");
  await expect(page.getByText("Username available")).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toHaveText("That username is already taken.");
  await expect(page.getByText("Username available")).toHaveCount(0);
});

test("Google linking requires a Factorize password and offers recovery", async ({ page, origin }) => {
  let sent;
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/v1/auth/google/pending", route => route.fulfill({ json: { email: "owner@example.test", mode: "link" } }));
  await page.route("**/api/v1/auth/google/finish", route => {
    sent = route.request().postDataJSON();
    return route.fulfill({ status: 401, json: { error: { code: "invalid_token", message: "Could not confirm your Factorize password." } } });
  });
  await page.goto(origin + "/auth/google");
  await expect(page.getByRole("heading", { name: "Connect Google to Factorize" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth/password-reset");
  await page.getByLabel("Factorize password").fill("fixture password");
  await page.getByRole("button", { name: "Connect and sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not confirm");
  expect(sent).toEqual({ password: "fixture password" });
});

test("first password requires Google confirmation and an emailed link before settings switches to Change password", async ({ page, origin }) => {
  let hasPassword = false;
  let mailed = 0;
  await page.route("**/api/v1/session", route => route.fulfill({ json: {
    authenticated: true, user: { id: "owner", email: "google-user@gmail.com" },
    team: { id: "workspace", name: "Workspace", role: "owner" }, capabilities: [], hasPassword, googleManagedRecovery: true,
  } }));
  await page.route("**/api/v1/auth/password/set-request", route => route.fulfill({ json: { authorizationUrl: origin + "/auth/google" } }));
  await page.route("**/api/v1/auth/google/pending", route => route.fulfill({ json: { email: "google-user@gmail.com", mode: "set-password" } }));
  await page.route("**/api/v1/auth/google/email/request", route => {
    mailed++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/auth/google/password/complete", route => {
    expect(route.request().postDataJSON()).toEqual({ token: "test-link", password: "my fixture password" });
    hasPassword = true;
    return route.fulfill({ json: { ok: true, returnTo: "/settings/password" } });
  });
  await page.goto(origin + "/settings/password");
  await expect(page.getByRole("heading", { name: "Set password" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Email me a confirmation link" }).click();
  await expect(page.getByRole("status")).toHaveText("Check your email for the confirmation link.");
  expect(mailed).toBe(1);
  await page.goto(origin + "/auth/google?token=test-link");
  await page.getByLabel("New password").fill("my fixture password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeVisible();
});

test("Google signup can confirm an external email and then choose a username", async ({ page, origin }) => {
  let confirmed = false;
  let request = 0;
  await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: false } }));
  await page.route("**/api/v1/auth/google/pending", route => route.fulfill({ json: {
    email: "owner@example.test", mode: confirmed ? "signup" : "verify-email",
  } }));
  await page.route("**/api/v1/auth/google/email/request", route => {
    request++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/auth/google/email/verify", route => {
    expect(route.request().postDataJSON()).toEqual({ token: "test-confirmation" });
    confirmed = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(origin + "/auth/google");
  await page.getByRole("button", { name: "Email me a confirmation link" }).click();
  await expect(page.getByRole("status")).toHaveText("Check your email for the confirmation link.");
  expect(request).toBe(1);
  await page.goto(origin + "/auth/google?token=test-confirmation");
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page.getByRole("heading", { name: "Choose your Factorize username" })).toBeVisible();
  await expect(page).toHaveURL(origin + "/auth/google");
});
