import type { HetznerFailure } from "../providers/hetzner-cloud";

type Diagnostic =
  | { provider: "hetzner"; operation: "validate_token" | "list_servers" | "lookup_server" | "provision_server";
      reason: HetznerFailure;
      upstreamStatus?: number }
  | { provider: "aws"; operation: "list_connections" | "prepare_connection" | "download_template" | "verify_role";
      reason: "signing_missing" | "signing_invalid" | "invalid_origin" | "signing_failed" | "trust_denied" | "permission_denied" | "upstream_error" | "verification_incomplete" };

/** Only fixed classifications and numeric status/timing cross the telemetry boundary. */
export function reportIntegrationFailure(detail: Diagnostic, started: number, operatorAttention: boolean) {
  const requestId = crypto.randomUUID();
  const upstreamStatus = "upstreamStatus" in detail ? detail.upstreamStatus : undefined;
  const event = { event: "integration_failure", requestId, provider: detail.provider,
    operation: detail.operation, reason: detail.reason, durationMs: Math.round(performance.now() - started),
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }) };
  if (operatorAttention) console.error(event);
  else console.warn(event);
  return requestId;
}
