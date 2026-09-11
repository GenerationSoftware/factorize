/** Turns a human flow name into a short, predictable Herdr workspace label. */
export function workspaceNameFor(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "flow";
}
