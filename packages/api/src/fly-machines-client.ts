/** A small, bounded adapter for Fly's documented Machines v1 API. */

export type FlyMachine = {
  id: string;
  name?: string;
  state?: string;
  config?: { metadata?: Record<string, string>; [key: string]: unknown };
  [key: string]: unknown;
};

export type FlyMachineConfig = Record<string, unknown> & {
  metadata?: Record<string, string>;
};

export type FlyClientErrorKind = "timeout" | "network" | "auth" | "rate_limit" | "server" | "http" | "invalid_response" | "ambiguous_create";

/** Error messages intentionally contain no URL, response body, or credential. */
export class FlyClientError extends Error {
  constructor(
    message: string,
    readonly kind: FlyClientErrorKind,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FlyClientError";
  }
}

export type FlyMachinesClientOptions = {
  token: string;
  /** Origin override is intended for local API tests. */
  apiOrigin?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
};

const DEFAULT_ORIGIN = "https://api.machines.dev";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 2;
const OPERATION_METADATA_KEY = "factorize_operation_id";

function segment(value: string, name: string): string {
  if (!value || value.includes("/") || value === "." || value === "..") {
    throw new TypeError(`${name} must be a non-empty path segment`);
  }
  return encodeURIComponent(value);
}

function errorFromStatus(status: number): FlyClientError {
  if (status === 401 || status === 403) return new FlyClientError("Fly authentication failed", "auth", status);
  if (status === 429) return new FlyClientError("Fly rate limit exceeded", "rate_limit", status);
  if (status >= 500) return new FlyClientError("Fly service failed", "server", status);
  if (status === 404) return new FlyClientError("Fly Machine was not found", "http", status);
  return new FlyClientError("Fly request failed", "http", status);
}

function isRetryable(error: unknown): boolean {
  return error instanceof FlyClientError && ["timeout", "network", "server", "rate_limit"].includes(error.kind);
}

/**
 * The client never retries machine creation. A create is reconciled by a stable
 * metadata operation id, so a repeated caller or ambiguous network result
 * discovers the already-created Machine instead of creating a duplicate.
 */
export function createFlyMachinesClient(options: FlyMachinesClientOptions) {
  if (!options.token) throw new TypeError("Fly token is required");
  const origin = (options.apiOrigin ?? DEFAULT_ORIGIN).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new TypeError("maxRetries must be between 0 and 5");
  const fetchImpl = options.fetch ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function request<T>(path: string, init: RequestInit, retrySafe: boolean): Promise<T> {
    let retries = 0;
    while (true) {
      let response: Response;
      try {
        response = await fetchImpl(`${origin}/v1${path}`, {
          ...init,
          headers: { authorization: `Bearer ${options.token}`, accept: "application/json", ...init.headers },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        const kind = cause instanceof Error && cause.name === "TimeoutError" ? "timeout" : "network";
        const error = new FlyClientError(kind === "timeout" ? "Fly request timed out" : "Fly network request failed", kind, undefined, { cause });
        if (retrySafe && retries < maxRetries && isRetryable(error)) {
          await wait(100 * (2 ** retries++));
          continue;
        }
        throw error;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const error = errorFromStatus(response.status);
        if (retrySafe && retries < maxRetries && isRetryable(error)) {
          await wait(100 * (2 ** retries++));
          continue;
        }
        throw error;
      }
      if (response.status === 204) return undefined as T;
      try {
        return await response.json() as T;
      } catch (cause) {
        const kind = cause instanceof Error && cause.name === "TimeoutError" ? "timeout" : "invalid_response";
        const error = new FlyClientError(kind === "timeout" ? "Fly request timed out" : "Fly returned an invalid response", kind, response.status, { cause });
        if (retrySafe && retries < maxRetries && isRetryable(error)) {
          await wait(100 * (2 ** retries++));
          continue;
        }
        throw error;
      }
    }
  }

  const appPath = (app: string) => `/apps/${segment(app, "app")}`;
  const machinePath = (app: string, machine: string) => `${appPath(app)}/machines/${segment(machine, "machine id")}`;

  async function findByOperationId(app: string, operationId: string): Promise<FlyMachine | undefined> {
    const machines = await request<FlyMachine[]>(`${appPath(app)}/machines`, { method: "GET" }, true);
    if (!Array.isArray(machines)) throw new FlyClientError("Fly returned an invalid Machine list", "invalid_response");
    return machines.find((machine) => machine.config?.metadata?.[OPERATION_METADATA_KEY] === operationId);
  }

  return {
    /** Resolve a previously persisted provisional run handle after a scheduler restart. */
    findMachineByOperationId(app: string, operationId: string): Promise<FlyMachine | undefined> {
      if (!operationId || operationId.length > 200) throw new TypeError("operationId must contain 1 to 200 characters");
      return findByOperationId(app, operationId);
    },
    async createMachine(app: string, config: FlyMachineConfig, operationId: string): Promise<FlyMachine> {
      if (!operationId || operationId.length > 200) throw new TypeError("operationId must contain 1 to 200 characters");
      const existing = await findByOperationId(app, operationId);
      if (existing) return existing;
      const body = {
        config: {
          ...config,
          // Job Machines are supervised by Factorize. A provider restart can
          // replay a script after an ambiguous guest exit, duplicating side
          // effects, so execution guests must stop with their process.
          restart: { policy: "no" },
          metadata: { ...config.metadata, [OPERATION_METADATA_KEY]: operationId },
        },
      };
      try {
        const created = await request<FlyMachine>(`${appPath(app)}/machines`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        }, false);
        if (!created || typeof created.id !== "string" || !created.id) {
          throw new FlyClientError("Fly returned an invalid created Machine", "invalid_response");
        }
        return created;
      } catch (cause) {
        // A 409 duplicate or a timeout/server/network failure may mean the
        // provider committed the create. Reconcile exactly once before failing.
        const ambiguous = cause instanceof FlyClientError &&
          (["timeout", "network", "server"].includes(cause.kind) || (cause.kind === "http" && cause.status === 409));
        if (!ambiguous) throw cause;
        try {
          const reconciled = await findByOperationId(app, operationId);
          if (reconciled) return reconciled;
        } catch {
          // Keep the original sanitized create error as the useful diagnosis.
        }
        throw new FlyClientError("Fly Machine creation outcome is ambiguous; retry with the same operationId", "ambiguous_create", undefined, { cause });
      }
    },
    inspectMachine(app: string, machine: string): Promise<FlyMachine> {
      return request(machinePath(app, machine), { method: "GET" }, true);
    },
    startMachine(app: string, machine: string): Promise<void> {
      return request(`${machinePath(app, machine)}/start`, { method: "POST" }, false);
    },
    stopMachine(app: string, machine: string): Promise<void> {
      return request(`${machinePath(app, machine)}/stop`, { method: "POST" }, false);
    },
    destroyMachine(app: string, machine: string): Promise<void> {
      return request(machinePath(app, machine), { method: "DELETE" }, true);
    },
    updateMachineConfig(app: string, machine: string, config: FlyMachineConfig): Promise<FlyMachine> {
      return request(machinePath(app, machine), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config }),
      }, true);
    },
  };
}
