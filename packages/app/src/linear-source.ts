import Mustache from "mustache";
import type { WorkItem } from "./types";

const object = (value: unknown): Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const decodeHtmlEntities = (value: string): string => value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/gi, (entity, decimal, hexadecimal, named) => {
  if (decimal) return String.fromCodePoint(Number(decimal));
  if (hexadecimal) return String.fromCodePoint(parseInt(hexadecimal, 16));
  return ({ amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' } as Record<string, string>)[named.toLowerCase()] ?? entity;
});
const text = (value: unknown): string => typeof value === "string" ? decodeHtmlEntities(value) : "";

export const DEFAULT_CONTEXT_TEMPLATE = `---
pipe: "{{{flow.name}}}"
issue: "{{{ticket.identifier}}}"
url: "{{{ticket.url}}}"
{{#ticket.project.name}}project: "{{{ticket.project.name}}}"
{{/ticket.project.name}}{{#ticket.labels.length}}labels: [{{#ticket.labels}}"{{{name}}}"{{^last}}, {{/last}}{{/ticket.labels}}]
{{/ticket.labels.length}}{{#ticket.assignee.name}}owner: "{{{ticket.assignee.name}}}"
{{/ticket.assignee.name}}{{#ticket.state.name}}status: "{{{ticket.state.name}}}"
{{/ticket.state.name}}---

# {{{ticket.title}}}

{{{ticket.description}}}`;

export interface SourceAdapter<TPayload> {
  toWorkItem(payload: TPayload, claimKey: string, event: Record<string, unknown>): WorkItem;
  renderPrompt(template: string, payload: TPayload, flowName: string): string;
}

export class LinearSourceAdapter implements SourceAdapter<Record<string, any>> {
  toWorkItem(payload: Record<string, any>, claimKey: string, event: Record<string, unknown>): WorkItem {
    return {
      provider: "linear", claimKey, identifier: claimKey,
      title: String(payload.title ?? payload.issue?.title ?? ""),
      description: String(payload.description ?? payload.issue?.description ?? ""),
      url: linearIssueUrl(payload, claimKey), event,
    };
  }

  renderPrompt(template: string, payload: Record<string, any>, flowName: string): string {
    return renderContextTemplate(template, payload, flowName);
  }
}

export function linearIssueUrl(data: Record<string, any>, issueId: string): string {
  const candidate = typeof data.url === "string" ? data.url : typeof data.issue?.url === "string" ? data.issue.url : "";
  return candidate.startsWith("https://linear.app/") ? candidate : `https://linear.app/issue/${encodeURIComponent(issueId)}`;
}

export function renderContextTemplate(template: string, payload: Record<string, unknown>, flowName: string): string {
  const issue = object(payload.issue);
  const ticket = text(issue.title) || text(issue.description) ? issue : payload;
  const project = object(ticket.project), assignee = object(ticket.assignee), state = object(ticket.state), labelsValue = object(ticket.labels);
  const rawLabels = Array.isArray(ticket.labels) ? ticket.labels : Array.isArray(labelsValue.nodes) ? labelsValue.nodes : [];
  const labels = rawLabels.map((label) => text(object(label).name)).filter(Boolean);
  const normalizedTicket = {
    ...ticket, id: text(ticket.id), identifier: text(ticket.identifier) || text(ticket.id), url: text(ticket.url),
    title: text(ticket.title) || "Untitled Linear issue", description: text(ticket.description).trim() || "No description provided.",
    project, assignee, state, labels: labels.map((name, index) => ({ name, last: index === labels.length - 1 })),
  };
  return Mustache.render(template || DEFAULT_CONTEXT_TEMPLATE, { ...payload, ticket: normalizedTicket, flow: { name: flowName } });
}

export const linearTicketPrompt = (payload: Record<string, unknown>, flowName: string) => renderContextTemplate(DEFAULT_CONTEXT_TEMPLATE, payload, flowName);
