import { expect, it, vi } from "vitest";
import { createMcpServer, requiredMcpToolScope } from "../src/transport/mcp/registry";
import type { ApiService } from "../src/api-service";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, DurableObject: class {} }));
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {}, AuthorizationError: class extends Error {}, getOAuthApi: vi.fn() }));

it("takes OAuth tool scopes from the same definitions used to register tools", () => {
  expect(requiredMcpToolScope("list_events")).toBe("triggers:read");
  expect(requiredMcpToolScope("create_event")).toBe("triggers:write");
  expect(requiredMcpToolScope("grant_vm_permissions")).toBe("vms:edit");
  expect(requiredMcpToolScope("import_attachment")).toBe("proxy:use");
  expect(requiredMcpToolScope("get_api_reflection")).toBeUndefined();
  expect(requiredMcpToolScope("nonexistent")).toBeUndefined();
  expect(() => createMcpServer({} as ApiService)).not.toThrow();
});
