import { messageOf } from "../auth/session";
export function validationMessage(error: unknown): string {
  const message = messageOf(error);
  if (!error || typeof error !== "object" || !("error" in error)) return message;
  const detail = error.error;
  if (!detail || typeof detail !== "object" || !("details" in detail) || !Array.isArray(detail.details)) return message;
  const issues = detail.details.flatMap(issue => issue && typeof issue === "object" && "message" in issue && typeof issue.message === "string" ? [issue.message] : []);
  return issues.length ? `${message} ${issues.slice(0, 8).join(" ")}` : message;
}
