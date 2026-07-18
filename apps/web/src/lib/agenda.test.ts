import {
  calendarDateInTimeZone,
  calendarDayRange,
  calendarOverdueRange,
  calendarUpcomingRange,
  defaultAppointmentStart,
  weeklyOccurrences,
  whatsappConfirmationLink,
} from "./agenda";
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

describe("weeklyOccurrences", () => {
  it("keeps the first occurrence identical to the start", () => {
    const [first] = weeklyOccurrences("2026-07-24T14:00:00.000Z", 4, "America/Sao_Paulo");

    expect(first.toISOString()).toBe("2026-07-24T14:00:00.000Z");
  });

  it("steps in exact weeks when no DST is involved", () => {
    const occurrences = weeklyOccurrences("2026-07-24T14:00:00.000Z", 3, "America/Sao_Paulo");

    expect(occurrences).toHaveLength(3);
    expect(occurrences[1].toISOString()).toBe("2026-07-31T14:00:00.000Z");
    expect(occurrences[2].toISOString()).toBe("2026-08-07T14:00:00.000Z");
  });

  it("keeps the wall-clock time across a DST change", () => {
    // 2026-03-05 09:00 America/New_York (EST, UTC-5); DST starts on March 8.
    const occurrences = weeklyOccurrences("2026-03-05T14:00:00.000Z", 2, "America/New_York");

    // Next week is EDT (UTC-4) but the appointment stays at 09:00 local.
    expect(occurrences[1].toISOString()).toBe("2026-03-12T13:00:00.000Z");
  });
});

describe("calendarOverdueRange", () => {
  it("ends at the practice midnight of today, excluding today itself", () => {
    // 23:30 on the 17th in São Paulo, already the 18th in UTC.
    const now = new Date("2026-07-18T02:30:00.000Z");
    const { start, end } = calendarOverdueRange(now, 60, "America/Sao_Paulo");

    expect(end.toISOString()).toBe("2026-07-17T03:00:00.000Z");
    expect(Math.round((end.getTime() - start.getTime()) / 86_400_000)).toBe(60);
  });
});

describe("whatsappConfirmationLink", () => {
  it("prefixes the Brazilian country code on a bare 11-digit mobile", () => {
    const link = whatsappConfirmationLink("11987654321", "Olá!");

    expect(link).toBe("https://wa.me/5511987654321?text=Ol%C3%A1!");
  });

  it("accepts a 10-digit landline-style number", () => {
    expect(whatsappConfirmationLink("1132654321", "oi")).toBe("https://wa.me/551132654321?text=oi");
  });

  it("passes through a number already carrying the country code", () => {
    expect(whatsappConfirmationLink("5511987654321", "oi")).toBe("https://wa.me/5511987654321?text=oi");
  });

  it("returns null for missing or unusable phones", () => {
    expect(whatsappConfirmationLink(null, "oi")).toBeNull();
    expect(whatsappConfirmationLink("", "oi")).toBeNull();
    expect(whatsappConfirmationLink("123", "oi")).toBeNull();
    // 12 digits not starting with 55 cannot be a BR number with country code.
    expect(whatsappConfirmationLink("441132654321", "oi")).toBeNull();
  });
});
