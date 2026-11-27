import { databaseFor } from "../../postgres/database";
import { ServiceError } from "../../service-contract";
import type { Env, OAuthProps } from "../../types";
import { awsIssuerStatus, signAwsWorkload } from "../providers/aws/issuer";
import { runAwsScript } from "../providers/aws/mcp-client";
import { awsRoleTemplate, awsVerificationMarker, awsVerificationScript, type AwsRegion } from "../providers/aws/policy";
import { exchangeAwsWorkload } from "../providers/aws/sts";
import { AwsUpstreamError } from "../providers/aws/wire";
import { AwsConnections, type AwsConnection } from "../storage/aws-connections";
import { reportIntegrationFailure } from "./diagnostics";

type OnboardingOperation = "prepare_connection" | "download_template" | "verify_role";
type Scope = "integrations:read" | "integrations:write";

export class AwsIntegrationService {
  constructor(private env: Env, private auth: OAuthProps, private authorizeIdentity: () => Promise<void>, private owner: (scope: Scope) => Promise<void>) {}

  private repository() { return new AwsConnections(databaseFor(this.env), this.auth.tenantId, this.auth.userId); }
  private issuer(operation?: OnboardingOperation, started = performance.now()) {
    const { config, reason } = awsIssuerStatus(this.env);
    if (config) return config;
    const requestId = operation && reportIntegrationFailure({ provider: "aws", operation, reason }, started, true);
    throw new ServiceError(503, "aws_unavailable", "AWS workload signing is not configured.", requestId);
  }
  private async find(id: string) {
    const connection = await this.repository().get(id);
    if (!connection) throw new ServiceError(404, "not_found", "AWS connection not found.");
    return connection;
  }

  async list() {
    await this.owner("integrations:read");
    const started = performance.now();
    const { config, reason } = awsIssuerStatus(this.env);
    const connections = await this.repository().list();
    const requestId = !config ? reportIntegrationFailure({ provider: "aws", operation: "list_connections", reason }, started, false) : undefined;
    return { body: { available: !!config, connections }, requestId };
  }
  async prepare(input: { name: string; region: AwsRegion }) {
    await this.owner("integrations:write");
    const issuer = this.issuer("prepare_connection");
    const connection = await this.repository().create(input.name, input.region);
    return { connection, template: JSON.stringify(awsRoleTemplate(issuer.issuer, connection.id), null, 2) };
  }
  async template(id: string) {
    await this.owner("integrations:read");
    const connection = await this.find(id);
    return { connection, template: JSON.stringify(awsRoleTemplate(this.issuer("download_template").issuer, id), null, 2) };
  }

  private async run(connection: AwsConnection, arn: string, code: string, recheck: () => Promise<void>, signal?: AbortSignal, auditDispatch?: () => void,
      verificationStarted?: number) {
    const issuer = this.issuer(verificationStarted === undefined ? undefined : "verify_role", verificationStarted);
    let signing = true;
    try {
      const token = await signAwsWorkload(issuer, connection.id);
      signing = false;
      await recheck();
      const credentials = await exchangeAwsWorkload(connection.region, arn, token, connection.id, signal);
      await recheck();
      const result = await runAwsScript(credentials, connection.region, code, async () => {
        await recheck();
        auditDispatch?.();
      }, signal);
      await recheck();
      return result;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const reason = signing ? "signing_failed" : error instanceof AwsUpstreamError && error.kind === "trust" ? "trust_denied" :
        error instanceof AwsUpstreamError && error.kind === "denied" ? "permission_denied" : "upstream_error";
      const requestId = verificationStarted === undefined ? undefined : reportIntegrationFailure(
        { provider: "aws", operation: "verify_role", reason }, verificationStarted, reason === "signing_failed" || reason === "upstream_error");
      if (reason === "trust_denied") throw new ServiceError(403, "aws_trust_denied", "AWS STS did not accept this connection. Check the role ARN, OIDC provider, audience and subject.", requestId);
      if (reason === "permission_denied") throw new ServiceError(403, "aws_permission_denied", "AWS did not allow this operation. Check the role’s IAM policy and organization restrictions.", requestId);
      throw new ServiceError(502, "aws_unavailable", "AWS did not return a completed Code Mode result. Do not retry a modifying script until you confirm its effects.", requestId);
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
    const started = performance.now();
    const probe = await this.run(current, arn, awsVerificationScript, check, signal, undefined, started);
    if (probe.status !== "completed" || probe.result !== awsVerificationMarker) {
      const requestId = reportIntegrationFailure({ provider: "aws", operation: "verify_role", reason: "verification_incomplete" }, started, true);
      throw new ServiceError(502, "aws_unavailable", "AWS MCP did not return the expected Code Mode result.", requestId);
    }
    if (current.roleArn) return { connection: current, verified: true as const };
    const connection = await this.repository().activate(id, current.revision, arn);
    if (!connection) throw new ServiceError(409, "conflict", "The AWS connection changed. Retry using its current settings.");
    return { connection, verified: true as const };
  }

  async allow(id: string, installationId: string | null) {
    await this.owner("integrations:write");
    const current = await this.find(id);
    if (!current.roleArn) throw new ServiceError(409, "conflict", "Verify the AWS role before granting access.");
    const connection = await this.repository().allow(id, current.revision, installationId, this.auth.sessionVersion);
    if (!connection) throw new ServiceError(409, "conflict", "Choose a current OAuth connection, or reload the AWS connection.");
    return connection;
  }

  async remove(id: string) {
    await this.owner("integrations:write");
    if (!(await this.repository().remove(id))) throw new ServiceError(404, "not_found", "AWS connection not found.");
    return { deleted: true as const };
  }

  async codeMode(id: string, code: string, signal?: AbortSignal) {
    const auth = this.auth;
    const { oauthInstallationId, oauthGrantId } = auth;
    if (auth.authMethod !== "oauth" || !oauthInstallationId || !oauthGrantId) throw new ServiceError(403, "forbidden", "An explicitly authorized Factorize OAuth connection is required.");
    const load = async () => {
      if (typeof auth.oauthExpiresAt !== "number" || !Number.isFinite(auth.oauthExpiresAt) || auth.oauthExpiresAt <= Date.now() / 1000) throw new ServiceError(401, "invalid_token", "The OAuth credential expired.");
      await this.authorizeIdentity();
      const current = await this.repository().getForGrant(id, oauthInstallationId, oauthGrantId, auth.sessionVersion);
      if (!current?.roleArn)
        throw new ServiceError(404, "not_found", "AWS connection not found.");
      return { ...current, roleArn: current.roleArn };
    };
    const current = await load();
    const recheck = async () => {
      if ((await load()).revision !== current.revision) throw new ServiceError(403, "forbidden", "AWS connection access changed.");
    };
    return this.run(current, current.roleArn, code, recheck, signal, () => {
      console.info(JSON.stringify({ event: "factorize_aws_code_mode_dispatched", connectionId: current.id, oauthInstallationId }));
    });
  }
}
