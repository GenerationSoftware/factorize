import { describe, expect, it } from "vitest";
import { matchingIssue } from "../src/matcher";

const ruleFlow = (type: "status" | "label", targetId: string) => ({ projectId: "project-1", matchRules: [{ type, targetId }] });
const statusFlow = ruleFlow("status", "todo");

describe("flow webhook matching", () => {
  it("queues a newly created issue in the selected status", () => {
    expect(matchingIssue({ type: "Issue", action: "create", data: { id: "issue-1", project: { id: "project-1" }, state: { id: "todo" } } }, statusFlow)).toBe("issue-1");
  });

  it("queues an issue only when it enters the selected status", () => {
    const event = { type: "Issue", action: "update", data: { id: "issue-1", project: { id: "project-1" }, state: { id: "todo" } }, updatedFrom: { stateId: "backlog" } };
    expect(matchingIssue(event, statusFlow)).toBe("issue-1");
    expect(matchingIssue({ ...event, updatedFrom: { stateId: "todo" } }, statusFlow)).toBeNull();
  });

  it("does not trigger a status flow for a new issue in another status", () => {
    expect(matchingIssue({ type: "Issue", action: "create", data: { id: "issue-1", project: { id: "project-1" }, state: { id: "backlog" } } }, statusFlow)).toBeNull();
  });

  it("queues a new issue that already has the selected label", () => {
    const labelFlow = ruleFlow("label", "bug");
    const event = { type: "Issue", action: "create", data: { id: "issue-1", project: { id: "project-1" }, labels: [{ id: "bug" }] } };
    expect(matchingIssue(event, labelFlow)).toBe("issue-1");
  });

  it("queues an existing issue as soon as the selected label is added", () => {
    const labelFlow = ruleFlow("label", "bug");
    const event = { type: "IssueLabel", action: "create", data: { issueId: "issue-1", issue: { project: { id: "project-1" } }, labelId: "bug" } };
    expect(matchingIssue(event, labelFlow)).toBe("issue-1");
  });

  it("queues an issue when Linear reports a label addition as an Issue update", () => {
    const labelFlow = ruleFlow("label", "odds-n-ends");
    const event = { type: "Issue", action: "update", data: { id: "issue-1", project: { id: "project-1" }, labels: [{ id: "odds-n-ends" }] }, updatedFrom: { labelIds: [] } };
    expect(matchingIssue(event, labelFlow)).toBe("issue-1");
  });

  it("does not rerun a label flow for an unrelated Issue update", () => {
    const labelFlow = ruleFlow("label", "odds-n-ends");
    const event = { type: "Issue", action: "update", data: { id: "issue-1", project: { id: "project-1" }, labels: [{ id: "odds-n-ends" }] }, updatedFrom: { title: "Old title" } };
    expect(matchingIssue(event, labelFlow)).toBeNull();
  });

  it("matches Linear's serialized IssueLabel record after its issue project is resolved", () => {
    const labelFlow = ruleFlow("label", "odds-n-ends-id");
    const event = { type: "IssueLabel", action: "create", data: { id: "issue-label-1", issueId: "issue-1", labelId: "odds-n-ends-id", issue: { id: "issue-1", project: { id: "project-1" } } } };
    expect(matchingIssue(event, labelFlow)).toBe("issue-1");
  });

  it("requires every configured rule and starts when the issue enters the matching set", () => {
    const flow = { projectId: "project-1", matchRules: [{ type: "status" as const, targetId: "todo" }, { type: "creator" as const, targetId: "person-1" }] };
    const event = { type: "Issue", action: "update", data: { id: "issue-1", project: { id: "project-1" }, state: { id: "todo" }, creator: { id: "person-1" } }, updatedFrom: { stateId: "backlog" } };
    expect(matchingIssue(event, flow)).toBe("issue-1");
    expect(matchingIssue({ ...event, data: { ...event.data, creator: { id: "person-2" } } }, flow)).toBeNull();
  });

  it("matches assignee and owner rules independently", () => {
    const event = { type: "Issue", action: "create", data: { id: "issue-1", project: { id: "project-1" }, assignee: { id: "assignee-1" }, owner: { id: "owner-1" } } };
    expect(matchingIssue(event, { projectId: "project-1", matchRules: [{ type: "assignee", targetId: "assignee-1" }, { type: "owner", targetId: "owner-1" }] })).toBe("issue-1");
  });

  it("uses the resolved issue details for composite IssueLabel rules", () => {
    const event = { type: "IssueLabel", action: "create", data: { issueId: "issue-1", labelId: "bug", issue: { id: "issue-1", project: { id: "project-1" }, state: { id: "todo" }, labels: [{ id: "bug" }] } } };
    expect(matchingIssue(event, { projectId: "project-1", matchRules: [{ type: "label", targetId: "bug" }, { type: "status", targetId: "todo" }] })).toBe("issue-1");
  });
});
