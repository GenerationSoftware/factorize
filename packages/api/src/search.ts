export type SearchMatch = { start: number; end: number };

export type RankedSearchMatch = { score: number; field: string; excerpt?: string; range?: SearchMatch };

const folded = (value: string) => value.normalize().toLocaleLowerCase();

/** Match one named field. Lower scores are more relevant. */
export function rankField(value: string, query: string, field: string): RankedSearchMatch | null {
  const haystack = folded(value), needle = folded(query.trim());
  if (!needle) return null;
  if (haystack === needle) return { score: field === "session" ? 2 : 0, field, range: { start: 0, end: value.length } };
  const start = haystack.indexOf(needle);
  if (start >= 0) return { score: field === "session" ? 2 : 1, field, range: { start, end: start + needle.length } };
  // Keep the useful VS Code-style behavior for queries whose characters are
  // separated in the field (for example, "gen2098" matching "GEN-2098").
  // This is deliberately a lower-ranked fallback than a contiguous match.
  const ranges = searchMatches(value, query);
  if (!ranges.length) return null;
  return {
    score: field === "session" ? 3 : 2,
    field,
    range: { start: ranges[0]!.start, end: ranges.at(-1)!.end },
  };
}

export function sessionExcerpt(value: string, range: SearchMatch, radius = 90): string {
  const start = Math.max(0, range.start - radius), end = Math.min(value.length, range.end + radius);
  return `${start ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
}

/** Match a query as an ordered sequence of terms, ignoring punctuation and case. */
export function searchMatches(value: string, query: string): SearchMatch[] {
  const needle = query.normalize().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!needle) return [];
  const positions: number[] = [];
  let cursor = 0;
  for (const character of needle) {
    let found = -1;
    for (let index = cursor; index < value.length; index++) {
      if (value[index]!.normalize().toLocaleLowerCase() === character) { found = index; break; }
    }
    if (found < 0) return [];
    positions.push(found);
    cursor = found + 1;
  }
  const ranges: SearchMatch[] = [];
  for (const position of positions) {
    const previous = ranges.at(-1);
    if (previous && previous.end === position) previous.end++;
    else ranges.push({ start: position, end: position + 1 });
  }
  return ranges;
}

export function matchesSearch(value: string, query: string): boolean { return searchMatches(value, query).length > 0; }
