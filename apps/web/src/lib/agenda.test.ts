import {
  calendarDateInTimeZone,
  calendarDayRange,
  calendarMonthRange,
  calendarOverdueRange,
  calendarUpcomingRange,
  calendarWeekRange,
  defaultAppointmentStart,
  seriesOccurrences,
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

describe("calendarWeekRange", () => {
  it("spans Monday to the next Monday around a mid-week anchor", () => {
    // 2026-08-05 is a Wednesday; its ISO week runs Mon 2026-08-03 → Mon 08-10.
    const { start, end } = calendarWeekRange(new Date(2026, 7, 5), "America/Sao_Paulo");

    expect(start.toISOString()).toBe("2026-08-03T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });

  it("treats Monday itself as the first day of its week", () => {
    // 2026-08-03 is a Monday — the week starts on it, not the previous Monday.
    const { start } = calendarWeekRange(new Date(2026, 7, 3), "America/Sao_Paulo");

    expect(start.toISOString()).toBe("2026-08-03T03:00:00.000Z");
  });

  it("treats Sunday as the last day of the week that began the prior Monday", () => {
    // 2026-08-09 is a Sunday — its week still starts Mon 2026-08-03.
    const { start, end } = calendarWeekRange(new Date(2026, 7, 9), "America/Sao_Paulo");

    expect(start.toISOString()).toBe("2026-08-03T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });
});

describe("calendarMonthRange", () => {
  it("spans the whole calendar month of the anchor", () => {
    const { start, end } = calendarMonthRange(new Date(2026, 7, 15), "America/Sao_Paulo");

    expect(start.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-01T03:00:00.000Z");
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

describe("seriesOccurrences", () => {
  const SP = "America/Sao_Paulo";
  // 2026-07-24 is a Friday, 11:00 in Sao Paulo (UTC-3).
  const friday = "2026-07-24T14:00:00.000Z";
  const dates = (occurrences: Date[]) => occurrences.map((date) => date.toISOString().slice(0, 10));

  it("spreads two sessions a week over alternate days, not two in a row", () => {
    // Fri + Mon, Fri + Mon — a 3-day gap inside each week.
    expect(dates(seriesOccurrences(friday, "twice_weekly", 4, SP))).toEqual([
      "2026-07-24",
      "2026-07-27",
      "2026-07-31",
      "2026-08-03",
    ]);
  });

  it("spreads three sessions a week every other day", () => {
    expect(dates(seriesOccurrences(friday, "thrice_weekly", 4, SP))).toEqual([
      "2026-07-24",
      "2026-07-26",
      "2026-07-28",
      "2026-07-31",
    ]);
  });

  it("steps daily and fortnightly by calendar days", () => {
    expect(dates(seriesOccurrences(friday, "daily", 3, SP))).toEqual(["2026-07-24", "2026-07-25", "2026-07-26"]);
    expect(dates(seriesOccurrences(friday, "biweekly", 3, SP))).toEqual(["2026-07-24", "2026-08-07", "2026-08-21"]);
  });

  it("keeps the day of the month monthly, clamping a short month", () => {
    // 31 Jan has no counterpart in February: it lands on the 28th, never 3 March.
    expect(dates(seriesOccurrences("2026-01-31T14:00:00.000Z", "monthly", 3, SP))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("keeps the wall-clock time across a DST change for every cadence", () => {
    // Sao Paulo has no DST, so use New York: 2026-03-05 09:00 EST -> EDT.
    const daily = seriesOccurrences("2026-03-05T14:00:00.000Z", "daily", 5, "America/New_York");

    // March 8 starts EDT (UTC-4); 09:00 local is 13:00Z instead of 14:00Z.
    expect(daily[2].toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(daily[4].toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("never returns an empty series", () => {
    expect(seriesOccurrences(friday, "weekly", 0, SP)).toHaveLength(1);
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
