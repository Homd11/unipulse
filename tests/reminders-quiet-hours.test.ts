import { afterEach, describe, expect, it } from "vitest";
import { isWithinQuietHours } from "@/lib/reminders";
const originalTimezone = process.env.REMINDER_TIMEZONE;
afterEach(() => { if (originalTimezone === undefined) delete process.env.REMINDER_TIMEZONE; else process.env.REMINDER_TIMEZONE = originalTimezone; });
describe("reminder quiet-hour boundaries", () => {
  it.each([
    ["2026-10-20T18:59:00Z", "22:00", "08:00", false],
    ["2026-10-20T19:00:00Z", "22:00", "08:00", true],
    ["2026-10-21T04:59:00Z", "22:00", "08:00", true],
    ["2026-10-21T05:00:00Z", "22:00", "08:00", false],
    ["2026-10-20T09:00:00Z", "12:00", "14:00", true],
    ["2026-10-20T11:00:00Z", "12:00", "14:00", false],
    ["2026-12-20T20:00:00Z", "22:00", "08:00", true],
    ["2026-10-20T09:00:00Z", "12:00", "12:00", false],
  ])("evaluates Cairo %s with %s–%s as %s", (instant, start, end, expected) => {
    delete process.env.REMINDER_TIMEZONE;
    expect(isWithinQuietHours(new Date(instant), start, end)).toBe(expected);
  });
  it("honors the explicitly configured timezone", () => {
    process.env.REMINDER_TIMEZONE = "UTC";
    expect(isWithinQuietHours(new Date("2026-10-20T21:30:00Z"), "22:00", "08:00")).toBe(false);
  });
  it("rejects an invalid timezone instead of using the server's clock", () => {
    expect(() => isWithinQuietHours(new Date(), "22:00", "08:00", "Invalid/Zone")).toThrow("Reminder timezone is invalid");
  });
});
