import { calendarDateInTimeZone, calendarDayRange, calendarUpcomingRange, defaultAppointmentStart } from "./agenda";
import { describe, expect, it } from "vitest";

describe("agenda calendar helpers", () => {
  it("builds a local calendar-day range instead of adding a fixed 24 hours", () => {
    const day = new Date(2026, 9, 18, 14, 35);
    const { start, end } = calendarDayRange(day, "America/Sao_Paulo");

    expect(start.toISOString()).toBe("2026-10-18T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-19T03:00:00.000Z");
  });

  it("suggests the next full hour when scheduling today", () => {
    const now = new Date("2026-07-16T10:23:41.000Z");
    const result = defaultAppointmentStart(new Date(2026, 6, 16), now, "UTC");

    expect(result.toISOString()).toBe("2026-07-16T11:00:00.000Z");
  });

  it("suggests 09:00 for another day", () => {
    const now = new Date("2026-07-16T10:23:00.000Z");
    const result = defaultAppointmentStart(new Date(2026, 6, 20), now, "UTC");

    expect(result.toISOString()).toBe("2026-07-20T09:00:00.000Z");
  });

  it("uses the practice date when the browser and practice cross midnight at different times", () => {
    const instant = new Date("2026-07-17T01:30:00.000Z");
    const practiceDate = calendarDateInTimeZone(instant, "America/Sao_Paulo");

    expect(practiceDate.getFullYear()).toBe(2026);
    expect(practiceDate.getMonth()).toBe(6);
    expect(practiceDate.getDate()).toBe(16);
  });

  it("builds a daylight-saving calendar range rather than assuming 24 hours", () => {
    const { start, end } = calendarDayRange(new Date(2026, 2, 8), "America/New_York");

    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("starts the upcoming window at the practice midnight even late at night across the date line", () => {
    // 23:30 on the 17th in São Paulo, already the 18th in UTC.
    const from = new Date("2026-07-18T02:30:00.000Z");
    const { start, end } = calendarUpcomingRange(from, 30, "America/Sao_Paulo");

    // Window opens at 2026-07-17 00:00 -03:00, not the browser's "tomorrow".
    expect(start.toISOString()).toBe("2026-07-17T03:00:00.000Z");
    // A consultation earlier that same evening (22:00 on the 17th) still falls inside.
    const lateAppointment = new Date("2026-07-18T01:00:00.000Z");
    expect(lateAppointment >= start && lateAppointment < end).toBe(true);
  });

  it("spans exactly the requested number of days", () => {
    const { start, end } = calendarUpcomingRange(new Date("2026-07-17T12:00:00.000Z"), 30, "America/Sao_Paulo");

    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(30);
  });
});
