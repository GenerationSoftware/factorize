import Mustache from "mustache";

/** Turns a human flow name into a short, predictable identifier. */
export function workspaceNameFor(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "flow";
}

export function workingDirectoryFor(template: string, flowId: string): string {
  return Mustache.render(template, { flowId });
}
