import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020";
import {
  API_ROUTES,
  generateOpenApi,
  isDeclaredApiOperation,
  matchApiOperation,
} from "../src/api-contract";
import { listRunsSchema, triggerInputSchema, vmImageVerificationInput, startRunInput } from "../src/flow-schemas";

export const openapi = parse(
  readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"),
);
const methods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

describe("versioned API contract", () => {
  it("accepts direct prompt and script launches with bounded overrides and permission subsets", () => {
    expect(startRunInput.safeParse({ prompt: "hello" }).success).toBe(true);
    expect(startRunInput.safeParse({ script: "#!/bin/sh\necho ok", vmImage: "ghcr.io/org/image@sha256:" + "a".repeat(64), executionConfigId: "config", model: "gpt-test", runScopes: [] }).success).toBe(true);
    expect(startRunInput.safeParse({}).success).toBe(false);
    expect(startRunInput.safeParse({ prompt: "hello", script: "echo ok" }).success).toBe(false);
    expect(startRunInput.safeParse({ prompt: " " }).success).toBe(false);
    expect(startRunInput.safeParse({ script: " " }).success).toBe(false);
    expect(startRunInput.safeParse({ script: "echo ok", runScopes: ["integration:private"] }).success).toBe(false);
  });
  it("validates run sorting fields and directions", () => {
    expect(listRunsSchema.safeParse({ sort: "source", direction: "asc" }).success).toBe(true);
    expect(listRunsSchema.safeParse({ sort: "agent", direction: "desc" }).success).toBe(true);
    expect(listRunsSchema.safeParse({ sort: "not-a-column" }).success).toBe(false);
    expect(listRunsSchema.safeParse({ direction: "asc" }).success).toBe(false);
    expect(listRunsSchema.safeParse({ state: ["failed", "stopped"] }).success).toBe(true);
    expect(listRunsSchema.safeParse({ state: ["failed", "not-a-state"] }).success).toBe(false);
  });
  it("accepts public image references and publishes tenant-scoped verification operations", () => {
    const trigger = { name: "image-trigger",  prompt: "Run", executionConfigId: "exe", vmImage: "ghcr.io/org/image:tag", events: [] };
    expect(triggerInputSchema.safeParse(trigger).success).toBe(true);
    expect(triggerInputSchema.parse({ ...trigger, vmImage: "ghcr.io/GenerationSoftware/anarack:ReleaseA" }).vmImage).toBe("ghcr.io/generationsoftware/anarack:ReleaseA");
    expect(triggerInputSchema.parse({ ...trigger, vmImage: "" }).vmImage).toBe("");
    const digest = `ghcr.io/GenerationSoftware/anarack:ReleaseA@sha256:${"a".repeat(64)}`;
    expect(triggerInputSchema.parse({ ...trigger, vmImage: digest }).vmImage).toBe(`ghcr.io/generationsoftware/anarack:ReleaseA@sha256:${"a".repeat(64)}`);
    const invalid = triggerInputSchema.safeParse({ ...trigger, vmImage: "https://private.example/image" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.issues[0].message).toContain("without a URL scheme");
    expect(vmImageVerificationInput.parse({ connectionId: "exe", image: "ghcr.io/GenerationSoftware/anarack:ReleaseA", tags: [] }).image).toBe("ghcr.io/generationsoftware/anarack:ReleaseA");
    expect(vmImageVerificationInput.safeParse({ connectionId: "exe", image: "bad image", tags: [] }).success).toBe(false);
    const post = API_ROUTES.find(route => route.path === "/api/v1/vm-image-verifications" && route.method === "POST");
    const get = API_ROUTES.find(route => route.path === "/api/v1/vm-image-verifications/{verificationId}" && route.method === "GET");
    expect(post?.scope).toBe("triggers:write"); expect(get?.scope).toBe("triggers:read");
    expect(openapi.paths["/api/v1/vm-image-verifications"].post.requestBody).toBeDefined();
  });
  it("publishes the authorized complete project graph operation", () => {
    const operation = API_ROUTES.find(route => route.method === "GET" && route.path === "/api/v1/triggers/graph");
    expect(operation?.scope).toBe("triggers:read");
    expect(openapi.paths["/api/v1/triggers/graph"].get["x-required-scope"]).toBe("triggers:read");
  });
  it("retires unlock and browser-capability operations and publishes owner-only model authorization", () => {
    expect(API_ROUTES.some(route=>route.path.includes("unlock-key")||route.path.includes("browser-capability")||route.path.includes("credential-proxy"))).toBe(false);
    for(const action of ["authorize","status","cancel"]){
      const route=API_ROUTES.find(item=>item.method==="POST"&&item.path===`/api/v1/model-accounts/{accountId}/authorization/${action}`);
      expect(route).toBeUndefined();
    }
  });
  it("lists only safe model account metadata for the owner browser", () => {
    const route = API_ROUTES.find(item => item.method === "GET" && item.path === "/api/v1/model-accounts");
    const create = API_ROUTES.find(item => item.method === "POST" && item.path === "/api/v1/model-accounts");
    const remove = API_ROUTES.find(item => item.method === "DELETE" && item.path === "/api/v1/model-accounts/{accountId}");
    expect(route?.scope).toBe("integrations:read");
    expect(route?.ownerSession).toBe(true);
    expect(route?.documentation.responses["200"].content["application/json"].schema.properties.accounts.items.properties.encryptedPayload).toBeUndefined();
    expect(create?.scope).toBe("integrations:write"); expect(create?.ownerSession).toBe(true);
    expect(create?.body?.safeParse({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedRevision: 0, idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Account", description: null, providerUrl:"https://models.fixture/v1" }).success).toBe(true);
    expect(create?.body?.safeParse({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedRevision: 0, idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Account", description: null, providerUrl:"https://models.fixture/v1", unlockKey: "must-not-be-accepted" }).success).toBe(false);
    expect(remove?.scope).toBe("integrations:write"); expect(remove?.ownerSession).toBe(true);
    expect(remove?.parameters.shape.accountId).toBeDefined();
    expect(openapi.paths["/api/v1/model-accounts"].post).toBeDefined();
    expect(openapi.paths["/api/v1/model-accounts/{accountId}"].delete).toBeDefined();
    expect(openapi.paths["/api/v1/model-accounts"].get).toBeDefined();
  });
  it("accepts bearer secrets only at the owner session boundary and publishes metadata only", () => {
    const list = API_ROUTES.find(item => item.method === "GET" && item.path === "/api/v1/integrations/bearer");
    const create = API_ROUTES.find(item => item.method === "POST" && item.path === "/api/v1/integrations/bearer");
    const input = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedRevision: 0, idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Build service", origin: "https://api.example.test", description: null, token: "server-managed-secret" };
    expect(list?.ownerSession).toBe(true);
    expect(create?.ownerSession).toBe(true);
    expect(create?.body?.safeParse(input).success).toBe(true);
    expect(create?.body?.safeParse({ ...input, unlockKey: "must-not-be-accepted" }).success).toBe(false);
    expect(create?.body?.safeParse({ ...input, encryptedPayload: "legacy-user-ciphertext" }).success).toBe(false);
    expect(list?.documentation.responses["200"].content["application/json"].schema.properties.integrations.items.properties.encryptedPayload).toBeUndefined();
  });
  it("accepts code triggers without agent prompts or models and rejects missing scripts", () => {
    const code = { name: "export",  executionType: "code", script: "#!/bin/sh\nprintf '{\"status\":\"succeeded\"}' > \"$FACTORIZE_RESULT_PATH\"", executionConfigId: "exe", events: [] };
    expect(triggerInputSchema.safeParse(code).success).toBe(true);
    expect(triggerInputSchema.safeParse({ ...code, script: " " }).success).toBe(false);
    expect(triggerInputSchema.safeParse({ name: "agent",  prompt: "Run", executionConfigId: "exe", events: [] }).success).toBe(true);
  });
  it("has full bidirectional method/path equality with the executable catalog", () => {
    const documented = Object.entries(openapi.paths).flatMap(([path, item]) =>
      Object.keys(item as object)
        .filter((method) => methods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    const executable = API_ROUTES.map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(new Set(executable).size).toBe(executable.length);
    expect(documented.sort()).toEqual(executable.sort());
    expect(API_ROUTES.every((route) => route.path.startsWith("/api/v1/"))).toBe(
      true,
    );
    expect(openapi).toEqual(generateOpenApi());
  });

  it("matches every catalog operation and decodes parameters without a second route list", () => {
    for (const route of API_ROUTES) {
      const path = route.path.replace(/\{[^}]+\}/g, "42");
      expect(matchApiOperation(route.method, path)?.route).toBe(route);
      expect(isDeclaredApiOperation("PATCH", path)).toBe(route.path === "/api/v1/runs/{runId}");
      expect(
        isDeclaredApiOperation(route.method, path + "/extra/extra/extra"),
      ).toBe(false);
    }
    expect(matchApiOperation("GET", "/api/v1/triggers/trigger%20one")?.params).toEqual({
      triggerId: "trigger one",
    });
    expect(isDeclaredApiOperation("GET", "/api" + "/connections/status")).toBe(
      false,
    );
    expect(isDeclaredApiOperation("GET", "/api/v1/not-declared")).toBe(false);
  });

  it("documents validation, authorization, media types, and resolvable response schemas for every operation", () => {
    for (const route of API_ROUTES) {
      const operation = openapi.paths[route.path][route.method.toLowerCase()];
      if (route.authOperation) {
        expect(operation["x-required-scope"]).toBeUndefined();
        expect(operation.security).toEqual(route.ownerSession ? [{ cookieAuth: [] }] : []);
      } else expect(operation["x-required-scope"]).toEqual(route.scope);
      expect(operation["x-owner-session-required"]).toBe(route.ownerSession);
      expect(
        operation.parameters
          ?.filter((p: any) => p.in === "path")
          .map((p: any) => p.name)
          .sort() ?? [],
      ).toEqual(Object.keys(route.parameters.shape).sort());
      expect(Boolean(operation.requestBody)).toBe(Boolean(route.body || route.rawBody));
      expect(operation.responses[route.status]).toBeDefined();
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      ajv.addSchema({
        $id: "https://factorize.test/contract",
        components: openapi.components,
      });
      for (const parameter of operation.parameters ?? [])
        ajv.compile({ components: openapi.components, ...parameter.schema });
      if(operation.requestBody)for(const content of Object.values(operation.requestBody.content) as any[])ajv.compile({components:openapi.components,...content.schema});
      for (const [status, response] of Object.entries(operation.responses) as [
        string,
        any,
      ][]) {
        const resolved = response.$ref
          ? openapi.components.responses[response.$ref.split("/").at(-1)]
          : response;
        if (!resolved.content) { expect(Number(status)).toBe(204); continue; }
        const mediaType = resolved.content["application/json"] ? "application/json" : "application/octet-stream";
        expect(resolved.content[mediaType].schema).toBeDefined();
        // Resolve every local reference, including nested references in trace diagnostics.
        ajv.compile({
          $id: `https://factorize.test/contract/${operation.operationId}/${status}`,
          components: openapi.components,
          ...resolved.content[mediaType].schema,
        });
      }
    }
  }, 30_000);

  it("keeps the exact committed REST artifact available in the Reference group", () => {
    const docs = JSON.parse(
      readFileSync(new URL("../../docs/docs.json", import.meta.url), "utf8"),
    );
    const pages = docs.navigation.groups.find((group: any) => group.group === "Reference").pages;
    expect(pages).toContain("api/reference");
    expect(pages.find((page: any) => page.openapi)?.openapi).toBe("/openapi.yaml");
    expect(readFileSync(new URL("../../docs/api/reference.mdx", import.meta.url), "utf8")).toContain("](/openapi.yaml)");

    const reference = readFileSync(
      new URL("../../docs/api/reference.mdx", import.meta.url),
      "utf8",
    );
    expect(reference).not.toMatch(/^\|/m);
  });
});
