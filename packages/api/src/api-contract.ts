import { z } from "zod";

import { triggerInputSchema, fireTriggerInputSchema, triggerConditionsTestSchema } from "./triggers/api/trigger-schemas";

import document from "./api-document.json";

import { integrationRoutes } from "./integrations/api/rest";
import { authRoutes } from "./auth/api/rest";
import { triggerRoutes } from "./triggers/api/rest";
import { accessRoutes } from "./access-control/api/rest";
import { vmGrantRoutes } from "./vm-grants/api/rest";
import { subscriptionRoutes } from "./subscriptions/api/rest";
import { eventRoutes } from "./events/api/rest";
import { proxyRoutes } from "./proxy/api/rest";
import { appRoutes } from "./apps/api/rest";
import { jsonSchema, type RouteContract } from "./transport/rest/route-contract";
export type { RouteContract } from "./transport/rest/route-contract";

// Each capability contributes one catalog. New operations belong in that module.
export const API_ROUTES: RouteContract[] = [
  ...authRoutes,
  ...accessRoutes,
  ...appRoutes,
  ...eventRoutes,
  ...integrationRoutes,
  ...proxyRoutes,
  ...subscriptionRoutes,
  ...triggerRoutes,
  ...vmGrantRoutes,
];

export const API_OPERATIONS = API_ROUTES.map(
  (route) => [route.method, route.path] as const,
);

const exactRoutes = new Map(API_ROUTES.filter(route => !route.path.includes("{")).map(route => [`${route.method} ${route.path}`, route]));
const matchers = API_ROUTES.filter(route => route.path.includes("{")).map((route) => ({
  route,
  specificity: route.path.split("/").map(segment => segment.startsWith("{") ? "0" : "1").join(""),
  keys: [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
  pattern: new RegExp(
    `^${route.path
      .split(/(\{[^}]+\})/)
      .map((part) =>
        part.startsWith("{")
          ? "([^/]+)"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("")}$`,
  ),
})).sort((left, right) => right.specificity.localeCompare(left.specificity));

export function matchApiOperation(method: string, path: string) {
  // Literal paths win independently of capability declaration order.
  const exact = exactRoutes.get(`${method} ${path}`);
  if (exact) return { route: exact, params: {} };
  for (const { route, keys, pattern } of matchers) {
    if (route.method !== method) continue;
    const match = pattern.exec(path);
    if (match)
      return {
        route,
        params: Object.fromEntries(
          keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]),
        ),
      };
  }
  return undefined;
}
export function isBrowserAuthOperation(method: string, path: string): boolean {
  return API_ROUTES.some(route => route.authOperation && route.method === method && route.path === path);
}
export function isDeclaredApiOperation(method: string, path: string): boolean {
  return matchApiOperation(method, path) !== undefined;
}

const errorContent = {
  "application/json": { schema: { $ref: "#/components/schemas/Error" } },
};

export function generateOpenApi() {
  const errors: Record<string, string> = {
    "400": "Invalid request",
    "401": "Invalid or revoked credentials",
    "403": "Missing scope or required owner session",
    "404": "Resource not found",
    "409": "Operation conflict",
    "415": "Unsupported media type; use application/json",
    "429": "Rate limit exceeded",
    "500": "Internal error",
    "503": "Service unavailable",
  };
  const errorResponses = Object.fromEntries(
    Object.entries(errors).map(([status, description]) => [
      `Error${status}`,
      { description, content: errorContent },
    ]),
  );
  const namedBodies: Record<string, z.ZodType> = {
    TriggerInput: triggerInputSchema,
    FireTriggerInput: fireTriggerInputSchema,
    TriggerConditionsTest: triggerConditionsTestSchema,
  };
  const schemas = {
    ...document.components.schemas,
    ...Object.fromEntries(
      Object.entries(namedBodies).map(([name, schema]) => [
        name,
        jsonSchema(schema),
      ]),
    ),
  };
  const bodySchema = (schema: z.ZodType) => {
    const name = Object.keys(namedBodies).find(
      (name) => namedBodies[name] === schema,
    );
    return name ? { $ref: `#/components/schemas/${name}` } : jsonSchema(schema);
  };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) {
    const parameters = [
      ...Object.entries(route.parameters.shape).map(([name, schema]) => ({
        name,
        in: "path",
        required: true,
        schema: jsonSchema(schema),
      })),
      ...Object.entries(route.query?.shape ?? {}).map(([name, schema]) => ({
        name,
        in: "query",
        required: !schema.isOptional(),
        schema: jsonSchema(schema, "output"),
      })),
    ];
    const responses: Record<string, any> = {};
    for (const status of Object.keys(errors)) {
      if (status === "415" && !route.body) continue;
      responses[status] = { $ref: `#/components/responses/Error${status}` };
    }
    for (const [status, response] of Object.entries(
      route.documentation.responses,
    ) as [string, any][]) {
      responses[status] = status.startsWith("2")
        ? {
            ...response,
            content: response.content ?? {
              "application/json": { schema: { type: "object" } },
            },
          }
        : {
            $ref: `#/components/responses/Error${status}`,
            description: response.description,
          };
    }
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      ...route.documentation,
      description: [
        route.documentation.description,
        route.authOperation || (Array.isArray(route.scope) && route.scope.length === 0) ? undefined : `Requires the ${Array.isArray(route.scope) ? route.scope.join(" and ") : route.scope.replaceAll("+", " and ")} scope${Array.isArray(route.scope) || route.scope.includes("+") ? "s" : ""}.`,
        route.authOperation ? undefined : route.ownerSession
          ? "An interactive owner session is required; bearer tokens cannot call this operation."
          : "Accepts a scoped bearer token or interactive owner session.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      operationId: `${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      tags: [route.path.split("/")[3]],
      security: route.authOperation ? (route.ownerSession ? [{ cookieAuth: [] }] : []) : route.ownerSession ? [{ cookieAuth: [] }] : [{ bearerAuth: [] }, { cookieAuth: [] }],
      ...(route.authOperation ? { "x-browser-auth-operation": route.authOperation } : { "x-required-scope": route.scope }),
      "x-owner-session-required": route.ownerSession,
      ...(parameters.length ? { parameters } : {}),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: bodySchema(route.body) },
              },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    ...document,
    components: { ...document.components, securitySchemes: { ...document.components.securitySchemes, cookieAuth: { type: "apiKey", in: "cookie", name: "factorize_session" } }, schemas, responses: errorResponses },
    paths,
  };
}
