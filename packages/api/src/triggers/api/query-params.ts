export function queryOf(value: Record<string, unknown>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    // Preserve repeated parameters such as multi-select filters.
    for (const entry of Array.isArray(item) ? item : [item]) query.append(key, String(entry));
  }
  return query;
}
