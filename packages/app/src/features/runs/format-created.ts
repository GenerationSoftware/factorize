export function formatCreated(value: string) {
  const date = new Date(value), age = Date.now() - date.getTime();
  if (age >= 0 && age < 24 * 60 * 60 * 1000) {
    const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60 * 60 * 1000, "hour"], [60 * 1000, "minute"], [1000, "second"]];
    const unit = units.find(([size]) => age >= size) ?? units.at(-1)!;
    return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(-Math.max(1, Math.floor(age / unit[0])), unit[1]);
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
