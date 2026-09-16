import type { MatchRule } from "./types";

type IssueReference = { id?: string; project?: { id?: string }; state?: { id?: string }; assignee?: { id?: string }; creator?: { id?: string }; owner?: { id?: string }; labels?: Array<{ id?: string }> };
type EventData = {
  id?: string;
  issueId?: string;
  labelId?: string;
  label?: { id?: string };
  labels?: Array<{ id?: string }>;
  project?: { id?: string };
  issue?: IssueReference;
  state?: { id?: string };
  assignee?: { id?: string };
  creator?: { id?: string };
  owner?: { id?: string };
};
type LinearEvent = { type?: string; action?: string; data?: EventData; updatedFrom?: { stateId?: string; assigneeId?: string; creatorId?: string; ownerId?: string; labelIds?: string[]; [key: string]: unknown } };

export type FlowMatcher = { projectId: string; matchRules: MatchRule[] };

/** Returns the issue to enqueue only when a webhook is relevant to a flow. */
export function matchingIssue(event: LinearEvent, flow: FlowMatcher): string | null {
  // IssueLabel events often nest the complete issue under `issue`; normalize
  // that shape so composite rules can use status, people, and labels too.
  const data = { ...(event.data?.issue ?? {}), ...(event.data ?? {}) } as EventData;
  const issueId = data.issueId ?? data.issue?.id ?? (event.type === "Issue" ? data.id : undefined);
  const projectId = data.project?.id ?? data.issue?.project?.id;
  const rules = flow.matchRules;
  if (!issueId || projectId !== flow.projectId || !rules.length) return null;

  // A flow starts on issue creation, or when a rule changes and the issue now
  // satisfies every configured rule. This makes multiple rules an AND filter.
  const isCreation = event.type === "Issue" && event.action === "create";
  const changed = (rule: MatchRule) => {
    if (rule.type === "label") return (event.type === "IssueLabel" && event.action === "create" && (data.labelId ?? data.label?.id) === rule.targetId)
      || (event.type === "Issue" && event.action === "update" && Array.isArray(event.updatedFrom?.labelIds) && !event.updatedFrom.labelIds.includes(rule.targetId));
    if (event.type !== "Issue" || event.action !== "update") return false;
    const previous = rule.type === "status" ? event.updatedFrom?.stateId : rule.type === "creator" ? event.updatedFrom?.creatorId : rule.type === "owner" ? event.updatedFrom?.ownerId : event.updatedFrom?.assigneeId;
    return previous !== rule.targetId;
  };
  const matches = (rule: MatchRule) => {
    if (rule.type === "label") return (event.type === "IssueLabel" && event.action === "create" && (data.labelId ?? data.label?.id) === rule.targetId)
      || data.labels?.some((label) => label.id === rule.targetId) === true;
    const person = rule.type === "creator" ? data.creator : rule.type === "owner" ? data.owner : data.assignee;
    return rule.type === "status" ? data.state?.id === rule.targetId : person?.id === rule.targetId;
  };
  return rules.every(matches) && (isCreation || rules.some(changed)) ? issueId : null;
}
