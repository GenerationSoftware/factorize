import assert from "node:assert/strict";
import { test } from "./fixtures.mjs";

let origin, browser;
test.beforeAll(async ({ origin: appOrigin, browser: chromium }) => {
  origin = appOrigin;
  browser = chromium;
});

async function setup() { const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(10000); await page.route("**/api/v1/session", route => route.fulfill({ json: { authenticated: true, user: { id: "owner", email: "owner@example.test" }, team: { id: "tenant", name: "Workspace" }, capabilities: [], expiresAt: "2026-10-10T00:00:00Z" } })); return { context, page }; }
test("consent refresh preserves OAuth query, scope selection and server-owned redirect", async () => {
  const { context, page } = await setup(); const previews = []; let decision;
  await page.route("**/api/v1/oauth/consent/preview", route => { previews.push(route.request().postDataJSON()); return route.fulfill({ json: { clientName: "External CLI", scopes: ["team:read", "triggers:read", "integrations:read", "triggers:write"], selectedScopes: ["team:read", "triggers:read", "integrations:read", "triggers:write"], request: "signed-request", signature: "signature", expiresAt: "2026-10-09T12:00:00Z" } }); });
  await page.route("**/api/v1/oauth/consent/decision", route => { decision = route.request().postDataJSON(); return route.fulfill({ json: { redirectTo: origin + "/completed?code=issued" } }); });
  await page.goto(origin + "/authorize?client_id=client&state=original&code_challenge=challenge"); await page.getByRole("heading", { name: "Authorize External CLI" }).waitFor(); await page.reload(); await page.getByLabel("triggers:write").uncheck(); await page.getByRole("button", { name: "Allow", exact: true }).click(); await page.waitForURL("**/completed?code=issued");
  assert.equal(previews.at(-1).authorizationQuery, "client_id=client&state=original&code_challenge=challenge"); assert.deepEqual(decision, { request: "signed-request", signature: "signature", decision: "allow", scopes: ["team:read", "triggers:read", "integrations:read"] }); await context.close();
});
for (const defaultScopes of [["team:read"], []]) {
  test(`Allow submits the displayed default selection (${defaultScopes.join(", ") || "empty"}) without any checkbox changes`, async () => {
    const { context, page } = await setup();
    try {
      await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: {
        clientName: "External CLI", scopes: ["team:read", "triggers:write"], selectedScopes: defaultScopes,
        request: "signed-request", signature: "signature", expiresAt: "2026-10-09T12:00:00Z",
      } }));
      let decision;
      await page.route("**/api/v1/oauth/consent/decision", route => {
        decision = route.request().postDataJSON();
        return route.fulfill({ json: { redirectTo: origin + "/completed?code=issued" } });
      });

      await page.goto(origin + "/authorize?client_id=client&state=original&code_challenge=challenge");
      await page.getByRole("heading", { name: "Authorize External CLI" }).waitFor();
      assert.equal(await page.getByLabel("team:read", { exact: true }).isChecked(), defaultScopes.includes("team:read"));
      assert.equal(await page.getByLabel("triggers:write", { exact: true }).isChecked(), false);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await page.waitForURL("**/completed?code=issued");
      assert.deepEqual(decision, { request: "signed-request", signature: "signature", decision: "allow", scopes: defaultScopes });
    } finally {
      await context.close();
    }
  });
}
test("device deep link loads metadata and approval sends no protocol tokens", async () => {
  const { context, page } = await setup(); let decision;
  await page.route("**/api/v1/oauth/device/preview", route => route.fulfill({ json: { userCode: "ABCD-EFGH", clientName: "My CLI", signature: "device-signature", scopes: ["team:read", "triggers:read", "integrations:read"], expiresAt: "2026-10-09T12:00:00Z" } }));
  await page.route("**/api/v1/oauth/device/decision", route => { decision = route.request().postDataJSON(); return route.fulfill({ json: { status: "approved" } }); });
  await page.goto(origin + "/device?user_code=ABCD-EFGH"); await page.getByRole("heading", { name: "Authorize My CLI" }).waitFor(); await page.reload(); await page.getByRole("button", { name: "Allow device" }).click(); await page.getByRole("status").filter({ hasText: "Device connected" }).waitFor(); assert.deepEqual(decision, { userCode: "ABCD-EFGH", signature: "device-signature", decision: "allow" }); await context.close();
});
test("expired device authorization is a safe visible error", async () => {
  const { context, page } = await setup(); await page.route("**/api/v1/oauth/device/preview", route => route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Invalid or expired device code." } } })); await page.goto(origin + "/device?user_code=EXPIRED"); await page.getByRole("alert").filter({ hasText: "Invalid or expired device code." }).waitFor(); assert.equal(await page.getByRole("button", { name: "Allow device" }).count(), 0); await context.close();
});

test("device code entry recovers from an expired attempt with a new client code and supports explicit denial", async () => {
  const { context, page } = await setup(); let decision;
  await page.route("**/api/v1/oauth/device/preview", route => route.request().postDataJSON().userCode === "EXPIRED"
    ? route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Expired code. Request a new code in your client." } } })
    : route.fulfill({ json: { userCode: "ABCD-2345", clientName: "New CLI", signature: "new-signature", scopes: [], expiresAt: new Date(Date.now() + 600000).toISOString() } }));
  await page.route("**/api/v1/oauth/device/decision", route => { decision = route.request().postDataJSON(); return route.fulfill({ json: { status: "denied" } }); });
  await page.goto(origin + "/device?user_code=EXPIRED&connection=old-attempt"); await page.getByRole("alert").waitFor();
  await page.getByLabel("Device code").fill("abcd-2345"); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: "Authorize New CLI" }).waitFor(); assert.equal(new URL(page.url()).searchParams.get("connection"), null);
  await page.getByRole("button", { name: "Deny device" }).click(); await page.getByRole("status").filter({ hasText: "Authorization denied" }).waitFor();
  assert.deepEqual(decision, { userCode: "ABCD-2345", signature: "new-signature", decision: "deny" }); await context.close();
});

test("failed reconnect approval reloads the review and never submits a new consent automatically", async () => {
  const { context, page } = await setup();
  try {
    let previewCount = 0;
    const approvals = [];
    await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: {
      clientName: "External CLI", reconnect: true, scopes: ["team:read", "triggers:write"], selectedScopes: ["team:read"],
      unavailableSavedScopes: ["triggers:read"], request: `request-${++previewCount}`, signature: "signature",
      expiresAt: "2026-10-09T12:00:00Z",
    } }));
    await page.route("**/api/v1/oauth/consent/decision", route => {
      approvals.push(route.request().postDataJSON());
      return approvals.length === 1 ? route.fulfill({ status: 400, json: { error: { code: "invalid_request", message: "Reload the request and review the permissions again." } } })
        : route.fulfill({ json: { redirectTo: origin + "/completed?code=issued" } });
    });
    await page.goto(origin + "/authorize?client_id=client&state=fresh&code_challenge=challenge");
    await page.getByRole("heading", { name: "Reconnect External CLI" }).waitFor();
    await page.getByRole("status").filter({ hasText: "These saved permissions are not available in this request and will not be in the new token: triggers:read" }).waitFor();
    await page.getByLabel("triggers:write").check();
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "Reload authorization request" }).click();
    assert.equal(await page.getByLabel("triggers:write").isChecked(), false);
    assert.equal(approvals.length, 1);
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await page.waitForURL("**/completed?code=issued");
    assert.deepEqual(approvals.map(({ request, scopes }) => [request, scopes]), [
      ["request-1", ["team:read", "triggers:write"]], ["request-2", ["team:read"]],
    ]);
  } finally {
    await context.close();
  }
});

test("reconnect separates granted, requested, blocked and optional permissions without prechecking step-up", async () => {
  const { context, page } = await setup();
  const blocked = "integration:18a2410e-ea09-4fe0-af8a-719c0c91e6e2:1";
  let decision;
  try {
    await page.route("**/api/v1/oauth/consent/preview", route => route.fulfill({ json: {
      clientName: "External CLI", reconnect: true, scopes: ["team:read", blocked, "triggers:write"],
      selectedScopes: ["team:read"], grantedScopes: ["team:read"], newScopes: [blocked],
      blockedScopes: [blocked], request: "signed-request", signature: "signature", expiresAt: "2026-10-09T12:00:00Z",
    } }));
    await page.route("**/api/v1/oauth/consent/decision", route => {
      decision = route.request().postDataJSON();
      return route.fulfill({ json: { redirectTo: origin + "/completed?code=issued" } });
    });
    await page.goto(origin + "/authorize?client_id=client&state=original&code_challenge=challenge");
    await page.getByRole("heading", { name: "Reconnect External CLI" }).waitFor();
    await page.getByText("Already granted", { exact: true }).waitFor();
    await page.getByText("New permission requested (blocked on current connection)", { exact: false }).waitFor();
    await page.getByText("Optional permission", { exact: true }).waitFor();
    assert.equal(await page.getByLabel(blocked, { exact: true }).isChecked(), false);
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await page.waitForURL("**/completed?code=issued");
    assert.deepEqual(decision.scopes, ["team:read"]);
  } finally {
    await context.close();
  }
});


test("defaults to the only compatible reconnect on a callback handoff and waits for approval", async () => {
  const { context, page } = await setup();
  try {
    const requests = [];
    let approval;
    const target = { kind: "installation", id: "existing-1" };
    await page.route("**/api/v1/oauth/consent/preview", route => {
      const body = route.request().postDataJSON();
      requests.push(body);
      const reconnect = !!body.target;
      return route.fulfill({json:{clientName:"External CLI", reconnect,
        targets:[{...target, name:"Laptop client", createdAt:"2026-10-09T12:00:00Z"}],
        scopes:["team:read","triggers:write"], selectedScopes:reconnect ? ["team:read", "triggers:write"] : [],
        savedOutsideRequestedScopes:reconnect ? ["triggers:write"] : [],
        unavailableSavedScopes:[], request:reconnect ? "reconnect-request" : "new-request", signature:"signed", expiresAt:"2026-10-09T12:00:00Z"}});
    });
    await page.route("**/api/v1/oauth/consent/decision", route => {
      approval = route.request().postDataJSON();
      return route.fulfill({json:{redirectTo:origin+"/completed?code=issued"}});
    });
    await page.goto(origin+"/authorize?client_id=client&connection=fixture");
    await page.getByRole("heading", {name:"Reconnect External CLI"}).waitFor();
    assert.equal(await page.getByRole("radio", {name:"Reconnect",exact:true}).isChecked(), true);
    assert.equal(await page.getByLabel("Connection to reconnect").inputValue(), "installation:existing-1");
    assert.equal(approval, undefined);
    await page.getByRole("radio", {name:"Create a separate connection"}).check();
    await page.getByRole("heading", {name:"Authorize External CLI"}).waitFor();
    assert.equal(await page.getByRole("radio", {name:"Create a separate connection"}).isChecked(), true);
    await page.getByRole("radio", {name:"Reconnect",exact:true}).check();
    await page.getByRole("heading", {name:"Reconnect External CLI"}).waitFor();
    await page.getByRole("heading", {name:"Additional permissions you saved for this connection"}).waitFor();
    assert.equal(await page.getByLabel("triggers:write").isChecked(), true);
    await page.getByLabel("triggers:write").uncheck();
    await page.getByRole("button", {name:"Allow", exact:true}).click();
    await page.waitForURL("**/completed?code=issued");
    assert.equal(requests[0].target, undefined);
    assert.deepEqual(requests[1].target, target);
    assert.deepEqual(approval, {request:"reconnect-request",signature:"signed",decision:"allow",scopes:["team:read"]});
  } finally { await context.close(); }
});


test("leaves a new request alone and requires a target when reconnect offers multiple installations", async () => {
  const { context, page } = await setup();
  try {
    const requests = [];
    await page.route("**/api/v1/oauth/consent/preview", route => {
      const body = route.request().postDataJSON();
      requests.push(body);
      const one = {kind:"installation", id:"existing-1", name:"Laptop", createdAt:"2026-10-09T12:00:00Z"};
      const targets = body.authorizationQuery.includes("connection=") ? [one,{...one,id:"existing-2",name:"Desktop"}] : [one];
      return route.fulfill({json:{clientName:"External CLI", reconnect:!!body.target, targets, scopes:[], selectedScopes:[],
        request:"signed-request", signature:"signature", expiresAt:"2026-10-09T12:00:00Z"}});
    });
    await page.goto(origin+"/authorize?client_id=client");
    await page.getByRole("button", {name:"Allow",exact:true}).waitFor();
    assert.equal(await page.getByRole("radio", {name:"Reconnect",exact:true}).count(), 0);
    assert.equal(await page.getByRole("button", {name:"Allow",exact:true}).isEnabled(), true);
    await page.goto(origin+"/authorize?client_id=client&connection=fixture");
    const reconnect = page.getByRole("radio", {name:"Reconnect",exact:true});
    await reconnect.waitFor();
    assert.equal(await reconnect.isChecked(), true);
    assert.equal(await page.getByLabel("Connection to reconnect").inputValue(), "");
    assert.equal(await page.getByRole("button", {name:"Allow",exact:true}).isEnabled(), false);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.target === undefined));
    await page.getByLabel("Connection to reconnect").selectOption("installation:existing-2");
    await page.getByRole("heading", {name:"Reconnect External CLI"}).waitFor();
    assert.deepEqual(requests[2].target, {kind:"installation", id:"existing-2"});
    assert.equal(await page.getByRole("button", {name:"Allow",exact:true}).isEnabled(), true);
  } finally { await context.close(); }
});
