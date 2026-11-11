import assert from "node:assert/strict";
import { test } from "node:test";
import { registerProxyBoot } from "../src/control-client.mjs";

const token = `fzc_${"A".repeat(43)}`;
const bootEpoch = "22222222-2222-4222-8222-222222222222";

test("boot registration uses a one-call control credential, HTTPS, exact path and fresh process epoch", async () => {
  let request;
  const result = await registerProxyBoot({ controlOrigin: "https://factorize.example", token, bootEpoch, fetchImpl: async (url, init) => {
    request = { url: String(url), init };
    return Response.json({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch });
  } });
  assert.deepEqual(result, { proxyIdentity: "proxy-fixture", bootEpoch });
  assert.equal(request.url, "https://factorize.example/internal/credential-proxy/register-boot");
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.redirect, "error");
  assert.deepEqual(JSON.parse(request.init.body), { bootEpoch });
});

test("boot registration rejects unsafe origins, invalid credentials and mismatched response bindings", async () => {
  await assert.rejects(registerProxyBoot({ controlOrigin: "http://factorize.example", token, bootEpoch }), /HTTPS origin/);
  await assert.rejects(registerProxyBoot({ controlOrigin: "https://factorize.example", token: "fzt_run_token", bootEpoch }), /credential/);
  await assert.rejects(registerProxyBoot({ controlOrigin: "https://factorize.example", token, bootEpoch, fetchImpl: async () => Response.json({ registered: true, proxyIdentity: "proxy-fixture", bootEpoch: "33333333-3333-4333-8333-333333333333" }) }), /invalid proxy boot registration response/);
});
