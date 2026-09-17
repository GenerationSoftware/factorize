import { describe, expect, it } from "vitest";
import { matchingClickUpTask } from "../src/clickup";

describe("ClickUp task matching", () => {
  const task = { id: "task-1", list: { id: "list-1" }, status: { status: "in progress" }, assignees: [{ id: 7 }], tags: [{ name: "agent" }], creator: { id: 9 } };

  it("requires the configured list and every rule", () => {
    expect(matchingClickUpTask(task, "list-1", [{ type: "status", targetId: "in progress" }, { type: "label", targetId: "agent" }, { type: "assignee", targetId: "7" }, { type: "creator", targetId: "9" }])).toBe(true);
    expect(matchingClickUpTask(task, "list-2", [{ type: "status", targetId: "in progress" }])).toBe(false);
    expect(matchingClickUpTask(task, "list-1", [{ type: "status", targetId: "done" }])).toBe(false);
  });

  it("fails closed without rules", () => {
    expect(matchingClickUpTask(task, "list-1", [])).toBe(false);
  });
});
