import { z } from "zod";
import { jsonSchema, route } from "../../transport/rest/route-contract";
import { awsConnectionList, awsConnectionMetadata, awsGrantInput, awsPrepareInput, awsSetup, awsVerified, awsVerifyInput } from "./aws-contracts";

const result = (schema: z.ZodType, description: string, status = 200) => ({
  responses: { [status]: { description, content: { "application/json": { schema: jsonSchema(schema, "output") } } } },
});
const base = "/api/v1/integrations/aws";
const item = base + "/{connectionId}";
const owner = { ownerSession: true };
const parameters = z.object({ connectionId: z.uuid() });
const scoped = { ...owner, parameters };
export const awsRoutes = [
  route("GET", base, "integrations:read", { summary: "List AWS connections", ...result(awsConnectionList, "AWS connection metadata and signing availability") },
    async service => {
      const { body, requestId } = await service.aws.list();
      return Response.json(body, { headers: requestId ? { "X-Request-Id": requestId } : undefined });
    }, owner),
  route("POST", base, "integrations:write", { summary: "Prepare an AWS connection", ...result(awsSetup, "Pending connection and its CloudFormation role template", 201) },
    (service, { body }) => service.aws.prepare(body), { ...owner, body: awsPrepareInput, maxBodyBytes: 1024 }),
  route("GET", item + "/template", "integrations:read", { summary: "Download an AWS connection role template", ...result(awsSetup, "Connection and CloudFormation role template") },
    (service, { params }) => service.aws.template(params.connectionId), scoped),
  route("POST", item + "/verify", "integrations:write", { summary: "Verify an AWS role with a harmless AWS MCP Code Mode script", ...result(awsVerified, "Verified AWS Code Mode connection") },
    (service, { params, body, signal }) => service.aws.verify(params.connectionId, body.roleArn, signal), { ...scoped, body: awsVerifyInput, maxBodyBytes: 2048 }),
  route("PUT", item + "/access", "integrations:write", { summary: "Assign or revoke Use access to this AWS connection", description: "An owner session with integrations:write can assign one current OAuth installation, or pass null to remove access. The assigned installation does not need an integration scope to run Code Mode.", ...result(awsConnectionMetadata, "AWS connection with its explicit Use grant") },
    (service, { params, body }) => service.aws.allow(params.connectionId, body.oauthInstallationId), { ...scoped, body: awsGrantInput, maxBodyBytes: 2048 }),
  route("DELETE", item, "integrations:write", { summary: "Delete an AWS connection in Factorize", description: "Does not delete the IAM role or OIDC provider in AWS.", ...result(z.object({ deleted: z.literal(true) }), "AWS connection removed") },
    (service, { params }) => service.aws.remove(params.connectionId), scoped),
];
