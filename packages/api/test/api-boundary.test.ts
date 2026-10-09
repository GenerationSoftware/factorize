import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020";
import { ProtectedApiHandler } from "../src/protected-api";
import { ApiService, ServiceError } from "../src/flow-service";
import { InvocationError } from "../src/job-domain";
import type { Env, OAuthProps } from "../src/types";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(
      public ctx: ExecutionContext<OAuthProps>,
      public env: Env,
    ) {}
  },
}));

afterEach(() => vi.restoreAllMocks());
const openapi = parse(
  readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"),
);
const auth = {
  tenantId: "tenant-1",
  userId: "user-1",
  sessionVersion: 1,
  authMethod: "session",
  scopes: ["flows:read", "flows:write", "runs:read", "runs:write"],
} as OAuthProps;

function request(
  method: string,
  path: string,
  body?: unknown,
  options: { raw?: string; mediaType?: string; auth?: OAuthProps } = {},
) {
  const worker = new ProtectedApiHandler(
    { props: options.auth ?? auth } as ExecutionContext<OAuthProps>,
    {} as Env,
  );
  return worker.fetch(
    new Request("https://example.com" + path, {
      method,
      ...(body !== undefined || options.raw !== undefined
        ? {
            body: options.raw ?? JSON.stringify(body),
            headers: {
              "Content-Type": options.mediaType ?? "application/json",
            },
          }
        : {}),
    }),
  );
}

async function assertResponse(
  response: Response,
  method: string,
  template: string,
  status: number,
) {
  expect(response.status).toBe(status);
  const mediaType = response.headers.get("content-type")?.split(";")[0];
  const reference =
    openapi.paths[template][method.toLowerCase()].responses[String(status)];
  expect(reference).toBeDefined();
  const documented = reference.$ref
    ? openapi.components.responses[reference.$ref.split("/").at(-1)]
    : reference;
  const schema = documented.content[mediaType!].schema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema({
    $id: "https://factorize.test/contract",
    components: openapi.components,
  });
  const validate = ajv.compile({
    $id: "https://factorize.test/contract/response",
    components: openapi.components,
    ...schema,
  });
  const body = await response.json();
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body as any;
}

const jobInput = {
  name: "Job",
  slug: "job",
  promptTemplate: "Do work",
  executionTargetId: "exe-1",
};

describe("Worker OpenAPI request/response boundaries", () => {
  it("returns a documented JSON array for a read", async () => {
    vi.spyOn(ApiService.prototype, "listJobs").mockResolvedValue([]);
    expect(
      await assertResponse(
        await request("GET", "/api/v1/jobs"),
        "GET",
        "/api/v1/jobs",
        200,
      ),
    ).toEqual([]);
  });

  it("validates and normalizes job input and uses the catalog's 201 status", async () => {
    const create = vi
      .spyOn(ApiService.prototype, "createJob")
      .mockResolvedValue({ id: "job-1", ...jobInput } as any);
    await assertResponse(
      await request("POST", "/api/v1/jobs", jobInput),
      "POST",
      "/api/v1/jobs",
      201,
    );
    expect(create).toHaveBeenCalledWith({
      ...jobInput,
      concurrencyLimit: 1,
      triggers: [],
    });
    for (const body of [
      {},
      { ...jobInput, concurrencyLimit: 51 },
      { ...jobInput, unexpected: true },
    ]) {
      const result = await assertResponse(
        await request("POST", "/api/v1/jobs", body),
        "POST",
        "/api/v1/jobs",
        400,
      );
      expect(result.error.code).toBe("invalid_request");
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("validates parsed method/path parameters and executes the existing service", async () => {
    vi.spyOn(ApiService.prototype as any, "authorize").mockResolvedValue(
      undefined,
    );
    const setEnabled = vi.fn().mockResolvedValue(true);
    vi.spyOn(ApiService.prototype as any, "jobs").mockReturnValue({
      setEnabled,
    });
    const result = await assertResponse(
      await request("POST", "/api/v1/jobs/job%20one/disable"),
      "POST",
      "/api/v1/jobs/{jobId}/disable",
      200,
    );
    expect(result).toEqual({ id: "job one", enabled: false });
    expect(setEnabled).toHaveBeenCalledWith(
      "job one",
      false,
      expect.any(String),
    );
    await assertResponse(
      await request(
        "GET",
        "/api/v1/providers/github/installations/not-a-number/repositories",
      ),
      "GET",
      "/api/v1/providers/github/installations/{installationId}/repositories",
      400,
    );
    await assertResponse(
      await request("GET", "/api/v1/jobs/%ZZ"),
      "GET",
      "/api/v1/jobs/{jobId}",
      400,
    );
  });

  it("documents the job name in run detail for clients with only runs:read", async () => {
    vi.spyOn(ApiService.prototype, "getRun").mockResolvedValue({ id: "run-1", state: "queued", job_name: "Job name", execution_diagnostics: null, harness_log: null });
    const result = await assertResponse(await request("GET", "/api/v1/runs/run-1", undefined, { auth: { ...auth, scopes: ["runs:read"] } }), "GET", "/api/v1/runs/{runId}", 200);
    expect(result.job_name).toBe("Job name");
  });

  it("returns documented 202 invocation bodies and 409 queue errors", async () => {
    const invoke = vi
      .spyOn(ApiService.prototype, "invokeJob")
      .mockResolvedValue({
        invocationId: "inv-1",
        runId: "run-1",
        state: "queued",
        duplicate: false,
      });
    await assertResponse(
      await request("POST", "/api/v1/jobs/job-1/invocations", {
        data: { issue: "GEN-2152" },
      }),
      "POST",
      "/api/v1/jobs/{jobId}/invocations",
      202,
    );
    expect(invoke).toHaveBeenCalledWith("job-1", {
      prompt: "",
      data: { issue: "GEN-2152" },
    });
    invoke.mockRejectedValue(
      new InvocationError("queue_full", "Queue is full"),
    );
    const result = await assertResponse(
      await request("POST", "/api/v1/jobs/job-1/invocations", {}),
      "POST",
      "/api/v1/jobs/{jobId}/invocations",
      409,
    );
    expect(result.error.code).toBe("queue_full");
    await assertResponse(
      await request("POST", "/api/v1/jobs/job-1/invocations", {
        idempotencyKey: "manual:reserved",
      }),
      "POST",
      "/api/v1/jobs/{jobId}/invocations",
      400,
    );
  });

  it("rejects malformed JSON and unsupported media types before invoking the service", async () => {
    const create = vi.spyOn(ApiService.prototype, "createJob");
    const malformed = await assertResponse(
      await request("POST", "/api/v1/jobs", undefined, { raw: "{" }),
      "POST",
      "/api/v1/jobs",
      400,
    );
    expect(malformed.error.code).toBe("invalid_request");
    await assertResponse(
      await request("POST", "/api/v1/jobs", jobInput, {
        mediaType: "text/plain",
      }),
      "POST",
      "/api/v1/jobs",
      415,
    );
    await assertResponse(
      await request("POST", "/api/v1/jobs", null),
      "POST",
      "/api/v1/jobs",
      400,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("enforces scope and interactive-session metadata and preserves service identity errors", async () => {
    const list = vi.spyOn(ApiService.prototype, "listJobs");
    const denied = await request("GET", "/api/v1/jobs", undefined, {
      auth: { ...auth, scopes: [] },
    });
    expect(denied.headers.get("www-authenticate")).toContain(
      "insufficient_scope",
    );
    await assertResponse(denied, "GET", "/api/v1/jobs", 403);
    expect(list).not.toHaveBeenCalled();
    list.mockRejectedValue(
      new ServiceError(401, "invalid_token", "Session revoked"),
    );
    await assertResponse(
      await request("GET", "/api/v1/jobs"),
      "GET",
      "/api/v1/jobs",
      401,
    );
    await assertResponse(
      await request("GET", "/api/v1/access-tokens", undefined, {
        auth: { ...auth, authMethod: "access_token" },
      }),
      "GET",
      "/api/v1/access-tokens",
      403,
    );
    await assertResponse(
      await request(
        "POST",
        "/api/v1/runs/11111111-1111-4111-8111-111111111111/trace/replay",
        { requestId: "11111111-1111-4111-8111-111111111111" },
        { auth: { ...auth, authMethod: "access_token" } },
      ),
      "POST",
      "/api/v1/runs/{runId}/trace/replay",
      403,
    );
  });

  it("validates pagination and trace query limits and returns documented page schemas", async () => {
    const list = vi
      .spyOn(ApiService.prototype, "listRuns")
      .mockResolvedValue({ items: [], nextCursor: null });
    await assertResponse(
      await request("GET", "/api/v1/runs?limit=100"),
      "GET",
      "/api/v1/runs",
      200,
    );
    expect(list.mock.calls[0][0].get("limit")).toBe("100");
    for (const query of ["limit=0", "limit=101", "limit=NaN", "state=invalid"])
      await assertResponse(
        await request("GET", "/api/v1/runs?" + query),
        "GET",
        "/api/v1/runs",
        400,
      );
    const trace = vi
      .spyOn(ApiService.prototype, "getRunTrace")
      .mockResolvedValue({ items: [], nextCursor: null });
    await assertResponse(
      await request("GET", "/api/v1/runs/run-1/trace?after=0&limit=200"),
      "GET",
      "/api/v1/runs/{runId}/trace",
      200,
    );
    expect(trace).toHaveBeenCalledWith("run-1", 0, 200);
    for (const query of ["after=-1", "after=NaN", "limit=201"])
      await assertResponse(
        await request("GET", "/api/v1/runs/run-1/trace?" + query),
        "GET",
        "/api/v1/runs/{runId}/trace",
        400,
      );
  });

  it("rejects undeclared methods and paths at the Worker boundary", async () => {
    expect((await request("PATCH", "/api/v1/jobs")).status).toBe(404);
    expect((await request("GET", "/api/v1/unknown")).status).toBe(404);
    const missing = vi
      .spyOn(ApiService.prototype, "getJob")
      .mockRejectedValue(new ServiceError(404, "not_found", "Job not found"));
    await assertResponse(
      await request("GET", "/api/v1/jobs/missing"),
      "GET",
      "/api/v1/jobs/{jobId}",
      404,
    );
    expect(missing).toHaveBeenCalledWith("missing");
  });
});
