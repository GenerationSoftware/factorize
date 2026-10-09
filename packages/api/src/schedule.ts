import { CronExpressionParser } from "cron-parser";

export interface ScheduleConfig {
  cron: string;
  timezone: string;
}

export type SimpleScheduleInterval = { unit: "minutes" | "hours"; value: number };

export function simpleIntervalToCron(interval: SimpleScheduleInterval): string {
  const maximum = interval.unit === "minutes" ? 59 : 23;
  if (!Number.isInteger(interval.value) || interval.value < 1 || interval.value > maximum) throw new Error(`Schedule interval must be between 1 and ${maximum} ${interval.unit}`);
  return interval.unit === "minutes" ? `*/${interval.value} * * * *` : `0 */${interval.value} * * *`;
}

export function simpleIntervalFromSchedule(config: ScheduleConfig): SimpleScheduleInterval | null {
  if (config.timezone !== "UTC") return null;
  const cron = config.cron.trim(), minutes = cron.match(/^\*\/(\d+) \* \* \* \*$/), hours = cron.match(/^0 \*\/(\d+) \* \* \*$/);
  if (cron === "* * * * *") return { unit: "minutes", value: 1 };
  if (cron === "0 * * * *") return { unit: "hours", value: 1 };
  if (minutes && Number(minutes[1]) >= 1 && Number(minutes[1]) <= 59) return { unit: "minutes", value: Number(minutes[1]) };
  if (hours && Number(hours[1]) >= 1 && Number(hours[1]) <= 23) return { unit: "hours", value: Number(hours[1]) };
  return null;
}

export function validateScheduleConfig(value: unknown): ScheduleConfig {
  const config = value as ScheduleConfig;
  if (!config || typeof config.cron !== "string" || typeof config.timezone !== "string") throw new Error("Schedule cron and timezone are required");
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(); }
  catch { throw new Error("Schedule timezone must be a valid IANA timezone"); }
  try { CronExpressionParser.parse(config.cron, { tz: config.timezone }); }
  catch { throw new Error("Schedule cron expression is invalid"); }
  return config;
}

/** cron-parser resolves skipped and repeated wall-clock times deterministically in the supplied IANA zone. */
export function nextOccurrence(config: ScheduleConfig, after: Date): Date {
  return CronExpressionParser.parse(config.cron, { currentDate: after, tz: config.timezone }).next().toDate();
}

export function catchUpOccurrence(config: ScheduleConfig, nextDue: Date, wakeAt: Date): { occurredAt: Date; nextRunAt: Date } | null {
  if (nextDue.getTime() > wakeAt.getTime()) return null;
  return { occurredAt: nextDue, nextRunAt: nextOccurrence(config, wakeAt) };
}
