import Mustache from "mustache";

/**
 * Compact JSON with recursively sorted object keys (integer keys retain JSON's
 * numeric ordering), array order preserved, and nested nulls retained.
 * Other values follow JSON.stringify's standard JSON conversion rules.
 */
function interpolationText(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  return JSON.stringify(value, (_key, entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
  });
}

// Normalize only interpolations: section truthiness, iteration, and dotted
// lookups must continue to operate on the original structured context.
class TextWriter extends Mustache.Writer {
  override unescapedValue(token: string[], context: Mustache.Context): string {
    return interpolationText(context.lookup(token[1]));
  }

  override escapedValue(token: string[], context: Mustache.Context): string {
    return this.unescapedValue(token, context);
  }
}

/** Agent input and display names are plain text; HTML escaping belongs at the UI boundary. */
export function renderTextTemplate(template: string, context: Record<string, unknown>): string {
  return new TextWriter().render(template, context);
}
