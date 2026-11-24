import Mustache from "mustache";

/** Turns a Trigger name into a short, predictable workspace identifier. */
export function triggerWorkspaceNameFor(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "trigger";
}

export function workingDirectoryFor(template: string, triggerId: string): string {
  return Mustache.render(template, { triggerId });
}
