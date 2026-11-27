import draft7 from "ajv/dist/refs/json-schema-draft-07.json";
import { validate } from "jsonschema";

export type MatchDecision = "matched" | "pending" | "excluded" | "failed";
export interface MatchInput {
  tenantId: string;
  triggerId: string;
  triggerRevision: number;
  sourceIdentity: string;
  deduplicationKey: string;
  evidence: Record<string, unknown>;
  decision: MatchDecision;
  pendingReason?: string;
  occurredAt?: string;
  githubSignal?: { minimumApprovals: number; requiredChecks: string[]; reviewerId?: string; reviewState?: string; reviewAt?: string; checkName?: string; checkConclusion?: string; checkAt?: string; deliveryId: string };
}
export interface MatchResult {
  matchId: string;
  outcome: MatchDecision;
  duplicate: boolean;
  pendingReason?: string;
  evaluationId?: string;
  occurrence: null | { id: string; definitionId: string; definitionRevision: number; occurredAt: string; payload: Record<string, unknown> };
}
// Event schemas are supplied at runtime. Workers cannot compile validators with eval.
const schemaOptions = { skipAttributes: ["format", "disallow", "extends"] };

export function validAgainstSchema(value: unknown, schema: object, path = "payload"): void {
  const schemaError = validate(schema, draft7, schemaOptions).errors[0];
  if (schemaError) throw new Error(`Invalid Event payload schema: ${schemaError.stack}`);

  const error = validate(value, schema, schemaOptions).errors[0];
  if (!error) return;
  const location = error.path.map(key => "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
  const message = error.name === "type" && Array.isArray(error.argument) && error.argument.length === 1
    ? `must be ${error.argument[0]}`
    : error.message;
  throw new Error(`${path}${location} ${message}`);
}

export function applyGitHubSignal(
  evidence: MatchInput["evidence"], signal: NonNullable<MatchInput["githubSignal"]>,
  prior?: { evidence?: MatchInput["evidence"]; outcome?: MatchDecision },
) {
  const priorEvidence = (prior?.evidence ?? {}) as Record<string, any>;
  const reviews = { ...(priorEvidence.reviews ?? {}) } as Record<string, any>;
  const checks = { ...(priorEvidence.checks ?? {}) } as Record<string, any>;
  const deliveries = new Set<string>(priorEvidence.contributing_delivery_ids ?? []);
  deliveries.add(signal.deliveryId);
  if (signal.reviewerId) {
    const old = reviews[signal.reviewerId];
    if (!old || (signal.reviewAt ?? "") >= old.at) reviews[signal.reviewerId] = { state: signal.reviewState, at: signal.reviewAt ?? "" };
  }
  if (signal.checkName) {
    const old = checks[signal.checkName];
    if (!old || (signal.checkAt ?? "") >= old.at) checks[signal.checkName] = { conclusion: signal.checkConclusion, at: signal.checkAt ?? "" };
  }
  const approvals = Object.values(reviews).filter((review: any) => String(review.state).toLowerCase() === "approved").length;
  const missingChecks = signal.requiredChecks.filter(name => String(checks[name]?.conclusion).toLowerCase() !== "success");
  const reasons = [approvals < signal.minimumApprovals ? `Waiting for ${signal.minimumApprovals-approvals} approved review(s).` : "", missingChecks.length ? `Waiting for successful checks: ${missingChecks.join(", ")}.` : ""].filter(Boolean);
  const nextEvidence = { ...priorEvidence, ...evidence, reviews, checks, contributing_delivery_ids: [...deliveries], evaluation: { approvals, required_approvals: signal.minimumApprovals, missing_checks: missingChecks } };
  const decision: MatchDecision = prior?.outcome === "matched" ? "matched" : reasons.length ? "pending" : "matched";
  const pendingReason = decision === "pending" ? reasons.join(" ") : undefined;
  return { evidence: nextEvidence, decision, pendingReason };
}
