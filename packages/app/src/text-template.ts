import Mustache from "mustache";

/** Agent input and display names are plain text; HTML escaping belongs at the UI boundary. */
export function renderTextTemplate(template: string, context: Record<string, unknown>): string {
  return Mustache.render(template, context, undefined, { escape: (value: string) => value });
}
