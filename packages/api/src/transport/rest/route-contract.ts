import { z } from "zod";
import type { ApiService } from "../../api-service";
import type { AuthAction } from "../../auth-api";

type JsonSchema = Record<string, any>;
export interface RouteContract {
  method: string;
  path: string;
  scope: string | string[];
  ownerSession: boolean;
  authOperation?: AuthAction;
  body?: z.ZodType;
  rawBody?:boolean;
  maxBodyBytes?: number;
  query?: z.ZodObject;
  parameters: z.ZodObject;
  status: number;
  documentation: Record<string, any>;
  execute: (
    service: ApiService,
    input: { params: Record<string, string>; body: any; query: any; url: URL; signal?: AbortSignal; request?:Request },
  ) => Promise<unknown>;
}

export function route(
  method: string,
  path: string,
  scope: string | string[],
  documentation: RouteContract["documentation"],
  execute: RouteContract["execute"],
  options: Partial<
    Pick<RouteContract, "body" | "rawBody" | "maxBodyBytes" | "query" | "ownerSession" | "parameters" | "authOperation" | "scope">
  > = {},
): RouteContract {
  const keys = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const parameters = z.object(
    Object.fromEntries(
      keys.map((key) => [
        key,
        key === "installationId" || key === "repositoryId"
          ? z.string().regex(/^[0-9]+$/)
          : z.string().min(1),
      ]),
    ),
  );
  const status = Number(
    Object.keys(documentation.responses).find((code) => code.startsWith("2")),
  );
  const requiredScope = scope;
  return {
    method,
    path,
    scope: requiredScope,
    parameters,
    status,
    ownerSession: false,
    documentation,
    execute,
    ...options,
  };
}

/** The executable API catalog: change an operation here, then run generate:openapi.
 * Service methods retain tenant/identity authorization for both REST and MCP.
 */
export function authRoute(method: string, path: string, action: AuthAction, summary: string, response: z.ZodType, body?: z.ZodType, status = 200): RouteContract {
  return {
    method, path, authOperation: action, scope: [], ownerSession: action === "password",
    parameters: z.object({}), body, status,
    documentation: {
      summary,
      description: "Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.",
      responses: { [status]: { description: "session" === action ? "Unauthenticated sessions return authenticated:false; expired, unverified, removed or revoked owners are unauthenticated." : "Success", headers: { "X-Factorize-Webhook-Conditions": { description: "Conditions-only webhook runtime deployment marker.", schema: { type: "string", const: "v1" } }, "X-Factorize-Contract": { description: "Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover.", schema: { type: "string", const: "gen-2157-static-v1" } } }, content: { "application/json": { schema: jsonSchema(response, "output") } } } },
    },
    execute: async () => { throw new Error("Auth operations must use the protected API dispatcher"); },
  };
}

export function jsonSchema(
  schema: z.ZodType,
  io: "input" | "output" = "input",
): JsonSchema {
  const { $schema, ...result } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  return result;
}
