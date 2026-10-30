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
import { listRunsSchema, jobInputSchema, vmImageVerificationInput } from "../src/flow-schemas";

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
  it("validates run sorting fields and directions", () => {
    expect(listRunsSchema.safeParse({ sort: "job", direction: "asc" }).success).toBe(true);
    expect(listRunsSchema.safeParse({ sort: "agent", direction: "desc" }).success).toBe(true);
    expect(listRunsSchema.safeParse({ sort: "not-a-column" }).success).toBe(false);
    expect(listRunsSchema.safeParse({ direction: "asc" }).success).toBe(false);
    expect(listRunsSchema.safeParse({ state: ["failed", "stopped"] }).success).toBe(true);
    expect(listRunsSchema.safeParse({ state: ["failed", "not-a-state"] }).success).toBe(false);
  });
  it("accepts public image references and publishes tenant-scoped verification operations", () => {
    const job = { name: "Image job", slug: "image-job", promptTemplate: "Run", executionConfigId: "exe", vmImage: "ghcr.io/org/image:tag", triggers: [] };
    expect(jobInputSchema.safeParse(job).success).toBe(true);
    expect(jobInputSchema.parse({ ...job, vmImage: "ghcr.io/GenerationSoftware/anarack:ReleaseA" }).vmImage).toBe("ghcr.io/generationsoftware/anarack:ReleaseA");
    expect(jobInputSchema.parse({ ...job, vmImage: "" }).vmImage).toBe("");
    const digest = `ghcr.io/GenerationSoftware/anarack:ReleaseA@sha256:${"a".repeat(64)}`;
    expect(jobInputSchema.parse({ ...job, vmImage: digest }).vmImage).toBe(`ghcr.io/generationsoftware/anarack:ReleaseA@sha256:${"a".repeat(64)}`);
    const invalid = jobInputSchema.safeParse({ ...job, vmImage: "https://private.example/image" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.issues[0].message).toContain("without a URL scheme");
    expect(vmImageVerificationInput.parse({ connectionId: "exe", image: "ghcr.io/GenerationSoftware/anarack:ReleaseA", tags: [], agentKind: "codex" }).image).toBe("ghcr.io/generationsoftware/anarack:ReleaseA");
    expect(vmImageVerificationInput.safeParse({ connectionId: "exe", image: "bad image", tags: [], agentKind: "codex" }).success).toBe(false);
    const post = API_ROUTES.find(route => route.path === "/api/v1/vm-image-verifications" && route.method === "POST");
    const get = API_ROUTES.find(route => route.path === "/api/v1/vm-image-verifications/{verificationId}" && route.method === "GET");
    expect(post?.scope).toBe("jobs:write"); expect(get?.scope).toBe("jobs:read");
    expect(openapi.paths["/api/v1/vm-image-verifications"].post.requestBody).toBeDefined();
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
    expect(matchApiOperation("GET", "/api/v1/jobs/job%20one")?.params).toEqual({
      jobId: "job one",
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
      } else expect(operation["x-required-scope"]).toBe(route.scope);
      expect(operation["x-owner-session-required"]).toBe(route.ownerSession);
      expect(
        operation.parameters
          ?.filter((p: any) => p.in === "path")
          .map((p: any) => p.name)
          .sort() ?? [],
      ).toEqual(Object.keys(route.parameters.shape).sort());
      expect(Boolean(operation.requestBody)).toBe(Boolean(route.body));
      expect(operation.responses[route.status]).toBeDefined();
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      ajv.addSchema({
        $id: "https://factorize.test/contract",
        components: openapi.components,
      });
      for (const parameter of operation.parameters ?? [])
        ajv.compile({ components: openapi.components, ...parameter.schema });
      if (operation.requestBody)
        ajv.compile({
          components: openapi.components,
          ...operation.requestBody.content["application/json"].schema,
        });
      for (const [status, response] of Object.entries(operation.responses) as [
        string,
        any,
      ][]) {
        const resolved = response.$ref
          ? openapi.components.responses[response.$ref.split("/").at(-1)]
          : response;
        expect(resolved.content["application/json"].schema).toBeDefined();
        // Resolve every local reference, including nested references in trace diagnostics.
        ajv.compile({
          $id: `https://factorize.test/contract/${operation.operationId}/${status}`,
          components: openapi.components,
          ...resolved.content["application/json"].schema,
        });
      }
    }
  }, 15_000);

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
