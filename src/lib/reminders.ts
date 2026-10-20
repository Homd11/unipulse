import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

export function hasSchedulerAuthorization(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function requireSchedulerAuthorization(request: Request): void {
  if (!process.env.CRON_SECRET) throw new ApiError(503, "Reminder scheduler is not configured");
  if (!hasSchedulerAuthorization(request)) throw new ApiError(401, "Scheduler authorization required");
}

export function isWithinQuietHours(now: Date, quietStart?: string | null, quietEnd?: string | null, timeZone = process.env.REMINDER_TIMEZONE || "Africa/Cairo"): boolean {
  if (!quietStart || !quietEnd) return false;
  const parseTime = (value: string) => {
    const match = /^(\d{2}):(\d{2})(?::00)?$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]); const minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  };
  const start = parseTime(quietStart); const end = parseTime(quietEnd);
  if (start === null || end === null || start === end) return false;
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); }
  catch { throw new ApiError(503, "Reminder timezone is invalid"); }
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const current = hour * 60 + minute;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
