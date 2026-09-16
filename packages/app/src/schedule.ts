import { CronExpressionParser } from "cron-parser";

export interface ScheduleConfig {
  cron: string;
  timezone: string;
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
