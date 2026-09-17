import type { MatchRule } from "./types";

export type ClickUpTask = Record<string, any> & { id?: string; list?: { id?: string }; status?: { status?: string }; assignees?: Array<{ id?: number | string }>; tags?: Array<{ name?: string }>; creator?: { id?: number | string } };

export function matchingClickUpTask(task: ClickUpTask, listId: string, rules: MatchRule[]): boolean {
  if (!task.id || String(task.list?.id ?? "") !== listId || !rules.length) return false;
  return rules.every(rule => {
    if (rule.type === "status") return task.status?.status === rule.targetId;
    if (rule.type === "label") return task.tags?.some(tag => tag.name === rule.targetId) === true;
    if (rule.type === "creator") return String(task.creator?.id ?? "") === rule.targetId;
    return task.assignees?.some(person => String(person.id) === rule.targetId) === true;
  });
}

export const clickUpHeaders = (token: string) => ({ Authorization: token, "Content-Type": "application/json" });

export async function clickUpJson(token: string, path: string): Promise<any> {
  const response = await fetch(`https://api.clickup.com/api/v2${path}`, { headers: clickUpHeaders(token) });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(body.err ?? body.error ?? `ClickUp request failed (${response.status})`);
  return body;
}
