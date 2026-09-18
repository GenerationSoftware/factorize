import type { ExecutionObservation } from "./execution";
import { scrubSession } from "./session-scrubber";

export const HARNESS_LOG_LIMIT = 64 * 1024;
export interface ExecutionDiagnostics {
  state: "succeeded" | "failed" | "stopped";
  detail: string | null;
  systemd: { loadState: string; activeState: string; subState: string; result: string; execMainCode: number | null; execMainStatus: number | null } | null;
}

/** Redact before truncation so a cut cannot expose part of a recognized credential. */
export function safeDiagnosticText(value: string, limit = 2048): string {
  const withoutAssignments = value.replace(/^.*["']?(?:[\w-]*(?:token|secret|password|passwd|api[_-]?key|authorization|cookie))["']?\s*[:=].*$/gim, "[REDACTED]");
  const safe = scrubSession(withoutAssignments)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/gi, "[REDACTED]")
    .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)\s*=\s*[^\r\n]+/g, "[REDACTED]")
    .replace(/([?&](?:token|key|signature|credential|password|secret|x-amz-[\w-]+)=)[^&#\s]+/gi, "$1[REDACTED]");
  return new TextDecoder().decode(new TextEncoder().encode(safe).slice(0, limit)).replace(/\uFFFD$/, "");
}

export function terminalDiagnostics(observation: ExecutionObservation): ExecutionDiagnostics {
  return {
    state: observation.state === "succeeded" ? "succeeded" : observation.state === "stopped" ? "stopped" : "failed",
    detail: observation.detail ? safeDiagnosticText(observation.detail) : null,
    systemd: observation.systemd ?? null,
  };
}
