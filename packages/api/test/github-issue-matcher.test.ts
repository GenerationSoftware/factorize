import { describe, expect, it } from "vitest";
import { matchingGitHubIssue } from "../src/github-issue-matcher";

const issue = { state: "open", user: { id: 1 }, assignees: [{ id: 2 }], labels: [{ id: 3 }] };

describe("matchingGitHubIssue", () => {
  it("matches all rules when a newly opened issue enters the set", () => {
    expect(matchingGitHubIssue({ action: "opened", issue }, [
      { type: "status", targetId: "open" }, { type: "label", targetId: "3" }, { type: "assignee", targetId: "2" }, { type: "creator", targetId: "1" },
    ])).toBe(true);
  });

  it("matches a label event only when that label completes the set", () => {
    const rules = [{ type: "status" as const, targetId: "open" }, { type: "label" as const, targetId: "3" }];
    expect(matchingGitHubIssue({ action: "labeled", label: { id: 3 }, issue }, rules)).toBe(true);
    expect(matchingGitHubIssue({ action: "labeled", label: { id: 4 }, issue }, rules)).toBe(false);
  });

  it("does not run for unrelated changes or partial matches", () => {
    expect(matchingGitHubIssue({ action: "edited", issue }, [{ type: "status", targetId: "open" }])).toBe(false);
    expect(matchingGitHubIssue({ action: "opened", issue }, [{ type: "status", targetId: "closed" }])).toBe(false);
  });
});
