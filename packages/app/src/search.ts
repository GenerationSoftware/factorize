export type SearchMatch = { start: number; end: number };

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
