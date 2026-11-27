import { strict as assert } from "node:assert";
import { test } from "node:test";
import { capabilityBoundaryViolations } from "./capability-boundaries.mjs";
const check = (file, code) => capabilityBoundaryViolations("/factorize/src/" + file, code);
test("rejects raw credential access and direct egress outside the designated adapters", () => {
  assert.equal(check("events/application/use-case.ts", 'import { resolveAgentCredential } from "../../credentials/application/agent-credentials";').length, 1);
  assert.equal(check("api-service.ts", 'export { forwardOutbound } from "./proxy/transport/outbound-forwarder";').length, 1);
  assert.equal(check("worker.ts", 'await import("./proxy/transport/credential-backed-egress");').length, 1);
  assert.deepEqual(check("proxy/transport/credential-backed-egress.ts", 'import { resolveAgentCredential } from "../../credentials/application/agent-credentials";'), []);
});
test("allows domain types but rejects infrastructure implementations", () => {
  assert.equal(check("events/domain/rule.ts", 'import { databaseFor } from "../../postgres/database";').length, 1);
  assert.deepEqual(check("events/domain/rule.ts", 'import type { Database } from "../../postgres/database";'), []);
});
