import { IntegrationTopologyChanged } from "../../integrations/storage/integration-removal-topology";

import { AgentApiError } from "../../proxy/application/agent-api";

import { z } from "zod";
import { ServiceError } from "../../api-service";

export function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof IntegrationTopologyChanged) return Response.json({ error:{ code:"conflict", message:error.message } }, {status:409});
  if (error instanceof AgentApiError) return Response.json({error: {code: error.code, message: error.message}}, {status: error.status, headers: error.code === "insufficient_scope" ? {"WWW-Authenticate": `Bearer error="insufficient_scope", scope="${error.scope}", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`} : undefined});
  if (error instanceof URIError) return Response.json({ error: { code: "invalid_request", message: "Invalid path encoding" } }, { status: 400 });
  if (error instanceof z.ZodError) {
    const imageIssue = error.issues.find(issue => issue.path.at(-1) === "vmImage" || issue.path.at(-1) === "image");
    const field = imageIssue?.path.join(".");
    const message = imageIssue && field ? `Invalid ${field}: ${imageIssue.message}` : "Request validation failed";
    return Response.json({ error: { code: "invalid_request", message, details: error.issues } }, { status: 400 });
  }
  if (error instanceof ServiceError) {
    const headers = error.code === "insufficient_scope" ? { "WWW-Authenticate": `Bearer error="insufficient_scope"` } : undefined;
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
  console.error("Protected API request failed", error);
  return Response.json({ error: { code: "internal_error", message: "Factorize could not complete this request." } }, { status: 500 });
}
