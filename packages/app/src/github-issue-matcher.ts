import type { MatchRule } from "./types";

type GitHubIssue = {
  state?: string;
  user?: { id?: number };
  assignee?: { id?: number } | null;
  assignees?: Array<{ id?: number }>;
  labels?: Array<{ id?: number }>;
};

type GitHubIssueEvent = {
  action?: string;
  issue?: GitHubIssue;
  label?: { id?: number };
  assignee?: { id?: number };
};

const idMatches = (value: number | undefined, target: string) => value !== undefined && String(value) === target;

/** Returns true only when an issue currently matches every rule and this event made it enter that set. */
export function matchingGitHubIssue(event: GitHubIssueEvent, rules: MatchRule[]): boolean {
  const issue = event.issue;
  if (!issue || !rules.length) return false;

  const matches = (rule: MatchRule): boolean => {
    if (rule.type === "status") return issue.state === rule.targetId;
    if (rule.type === "label") return issue.labels?.some(label => idMatches(label.id, rule.targetId)) === true;
    if (rule.type === "creator") return idMatches(issue.user?.id, rule.targetId);
    if (rule.type === "assignee" || rule.type === "owner") {
      return issue.assignees?.some(assignee => idMatches(assignee.id, rule.targetId)) === true
        || idMatches(issue.assignee?.id, rule.targetId);
    }
    return false;
  };
  if (!rules.every(matches)) return false;

  const action = event.action;
  if (action === "opened" || action === "reopened") return true;
  return rules.some(rule =>
    (rule.type === "status" && action === "closed" && rule.targetId === "closed")
    || (rule.type === "label" && action === "labeled" && idMatches(event.label?.id, rule.targetId))
    || ((rule.type === "assignee" || rule.type === "owner") && action === "assigned" && idMatches(event.assignee?.id, rule.targetId)),
  );
}
