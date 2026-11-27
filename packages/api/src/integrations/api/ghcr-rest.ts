import { z } from "zod";
import { jsonSchema, route } from "../../transport/rest/route-contract";
import { ghcrConnection, ghcrCreate, ghcrReplace } from "./ghcr-contracts";

const path = "/api/v1/integrations/ghcr";
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema: jsonSchema(schema, "output") } } });
export const ghcrRoutes = [
  route("GET", path, "integrations:read", {
    summary: "List GitHub Container Registry connections", responses: {"200": json(z.array(ghcrConnection), "Secret-free connections")},
  }, service => service.integrations.listGhcrConnections(), { ownerSession: true }),
  route("POST", path, "integrations:write", {
    summary: "Connect one GitHub Container Registry image", description: "Save a classic GitHub personal access token for one fixed image. Use read:packages for pulls or write:packages to additionally allow pushes. GitHub credentials are never returned.",
    responses: {"201": json(ghcrConnection, "Connection saved")},
  }, (service,{body}) => service.integrations.createGhcrConnection(body), { body: ghcrCreate, ownerSession: true, maxBodyBytes: 4096 }),
  route("PUT", path + "/{connectionId}", "integrations:write", {
    summary: "Replace a GitHub Container Registry credential", description: "Rotate the credential without changing the image or its client approvals.",
    responses: {"200": json(ghcrConnection, "Credential replaced")},
  }, (service,{params,body}) => service.integrations.replaceGhcrConnection(params.connectionId,body),
  { body: ghcrReplace, ownerSession: true, maxBodyBytes: 4096, parameters: z.object({ connectionId: z.uuid() }) }),
];
