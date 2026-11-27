import { databaseFor } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import type { Env, OAuthProps } from "../../types";
import { awsIssuer, signAwsWorkload } from "../providers/aws/issuer";
import { readAwsInventory } from "../providers/aws/mcp-client";
import { awsRoleTemplate, type AwsRegion, type AwsService } from "../providers/aws/policy";
import { exchangeAwsWorkload } from "../providers/aws/sts";
import { AwsUpstreamError } from "../providers/aws/wire";
import { AwsConnections, type AwsConnection } from "../storage/aws-connections";

type Scope = "integrations:read" | "integrations:write";

export class AwsIntegrationService {
  constructor(private env: Env, private auth: OAuthProps, private authorize: (scope: Scope) => Promise<void>, private owner: (scope: Scope) => Promise<void>) {}

  private repository() { return new AwsConnections(databaseFor(this.env), this.auth.tenantId, this.auth.userId); }
  private issuer() {
    const issuer = awsIssuer(this.env);
    if (!issuer) throw new ServiceError(503, "aws_unavailable", "AWS workload signing is not configured.");
    return issuer;
  }
  private async find(id: string) {
    const connection = await this.repository().get(id);
    if (!connection) throw new ServiceError(404, "not_found", "AWS connection not found.");
    return connection;
  }

  async list() {
    await this.owner("integrations:read");
    return { available: !!awsIssuer(this.env), connections: await this.repository().list() };
  }
  async prepare(input: { name: string; region: AwsRegion }) {
    await this.owner("integrations:write");
    const issuer = this.issuer();
    const connection = await this.repository().create(input.name, input.region);
    return { connection, template: JSON.stringify(awsRoleTemplate(issuer.issuer, connection.id), null, 2) };
  }
  async template(id: string) {
    await this.owner("integrations:read");
    const connection = await this.find(id);
    return { connection, template: JSON.stringify(awsRoleTemplate(this.issuer().issuer, id), null, 2) };
  }

  private async read(connection: AwsConnection, arn: string, service: AwsService, recheck: () => Promise<void>, signal?: AbortSignal) {
    const issuer = this.issuer();
    try {
      const token = await signAwsWorkload(issuer, connection.id);
      await recheck();
      const credentials = await exchangeAwsWorkload(connection.region, arn, token, connection.id, signal);
      await recheck();
      const result = await readAwsInventory(credentials, connection.region, service, signal);
      await recheck();
      return result;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof AwsUpstreamError && error.kind === "trust") throw new ServiceError(403, "aws_trust_denied", "AWS STS did not accept this connection. Check the role ARN, OIDC provider, audience and subject.");
      if (error instanceof AwsUpstreamError && error.kind === "denied") throw new ServiceError(403, "aws_permission_denied", "AWS did not allow this read. Check the role’s IAM policy and organization restrictions.");
      throw new ServiceError(502, "aws_unavailable", "AWS did not complete the requested inventory read.");
    }
  }

  async verify(id: string, arn: string, signal?: AbortSignal) {
    await this.owner("integrations:write");
    const current = await this.find(id);
    if (current.roleArn && current.roleArn !== arn) throw new ServiceError(409, "conflict", "Create a new connection to use a different AWS role.");
    const check = async () => {
      await this.owner("integrations:write");
      if ((await this.find(id)).revision !== current.revision) throw new ServiceError(409, "conflict", "The AWS connection changed. Retry using its current settings.");
    };
    const inventory = await this.read(current, arn, "lambda", check, signal);
    if (current.roleArn) return { connection: current, inventory };
    const connection = await this.repository().activate(id, current.revision, arn);
    if (!connection) throw new ServiceError(409, "conflict", "The AWS connection changed. Retry using its current settings.");
    return { connection, inventory };
  }

  async allow(id: string, installationId: string | null) {
    await this.owner("integrations:write");
    const current = await this.find(id);
    if (!current.roleArn) throw new ServiceError(409, "conflict", "Verify the AWS role before granting access.");
    const connection = await this.repository().allow(id, current.revision, installationId, this.auth.sessionVersion);
    if (!connection) throw new ServiceError(409, "conflict", "Choose a current OAuth connection with integrations:read, or reload the AWS connection.");
    return connection;
  }

  async remove(id: string) {
    await this.owner("integrations:write");
    if (!(await this.repository().remove(id))) throw new ServiceError(404, "not_found", "AWS connection not found.");
    return { deleted: true as const };
  }

  async inventory(id: string, service: AwsService, signal?: AbortSignal) {
    const auth = this.auth;
    const { oauthInstallationId, oauthGrantId } = auth;
    if (auth.authMethod !== "oauth" || !oauthInstallationId || !oauthGrantId) throw new ServiceError(403, "forbidden", "An explicitly authorized Factorize OAuth connection is required.");
    const load = async () => {
      await this.authorize("integrations:read");
      if (!auth.oauthExpiresAt || auth.oauthExpiresAt <= Date.now() / 1000) throw new ServiceError(401, "invalid_token", "The OAuth credential expired.");
      const current = await this.repository().getForGrant(id, oauthInstallationId, oauthGrantId, auth.sessionVersion);
      if (!current?.roleArn)
        throw new ServiceError(404, "not_found", "AWS connection not found.");
      return { ...current, roleArn: current.roleArn };
    };
    const current = await load();
    const recheck = async () => {
      if ((await load()).revision !== current.revision) throw new ServiceError(403, "forbidden", "AWS connection access changed.");
    };
    return this.read(current, current.roleArn, service, recheck, signal);
  }
}
