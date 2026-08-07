import { isImplausibleBirthDate, parseDateValue, resolveDateOrder } from "./dates";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-08-07T12:00:00.000Z");

describe("date order, decided per column", () => {
  it("proves day-first from a single day above 12", () => {
    const verdict = resolveDateOrder(["03/04/1985", "25/12/1990", "01/02/2000"]);
    expect(verdict).toMatchObject({ order: "dmy", ambiguous: false, reason: "day_over_12" });
  });

  it("proves month-first the same way", () => {
    expect(resolveDateOrder(["12/25/1990", "01/02/2000"])).toMatchObject({
      order: "mdy",
      ambiguous: false,
    });
  });

  it("recognizes ISO without guessing", () => {
    expect(resolveDateOrder(["1985-04-03", "1990-12-25"])).toMatchObject({ order: "iso", ambiguous: false });
  });

  it("refuses to choose when every value reads both ways", () => {
    const verdict = resolveDateOrder(["03/04/1985", "05/06/1990"]);
    expect(verdict.order).toBeNull();
    expect(verdict.ambiguous).toBe(true);
    expect(verdict.reason).toBe("no_evidence");
  });

  it("reports a column that contradicts itself rather than picking a side", () => {
    const verdict = resolveDateOrder(["25/12/1990", "12/25/1990"]);
    expect(verdict.order).toBeNull();
    expect(verdict.reason).toBe("conflicting");
  });

  it("says nothing about an empty column", () => {
    expect(resolveDateOrder(["", "  "])).toMatchObject({ reason: "empty", ambiguous: false });
  });
});

describe("date parsing", () => {
  it("reads the same value differently under each order — which is the whole point", () => {
    expect(parseDateValue("03/04/1985", "dmy", NOW)).toBe("1985-04-03");
    expect(parseDateValue("03/04/1985", "mdy", NOW)).toBe("1985-03-04");
  });

  it("rejects a date that does not exist instead of rolling it over", () => {
    expect(parseDateValue("31/02/1985", "dmy", NOW)).toBeNull();
    expect(parseDateValue("00/04/1985", "dmy", NOW)).toBeNull();
  });

  it("expands two-digit years backwards from today", () => {
    expect(parseDateValue("14/03/88", "dmy", NOW)).toBe("1988-03-14");
    expect(parseDateValue("14/03/05", "dmy", NOW)).toBe("2005-03-14");
  });

  it("ignores the time exports tack on", () => {
    expect(parseDateValue("14/03/1988 00:00:00", "dmy", NOW)).toBe("1988-03-14");
  });

  it("accepts ISO under any declared order", () => {
    expect(parseDateValue("1988-03-14", "dmy", NOW)).toBe("1988-03-14");
  });

  it("returns nothing for text it cannot read", () => {
    expect(parseDateValue("não informado", "dmy", NOW)).toBeNull();
  });
});

describe("implausible birth dates", () => {
  it("flags a date in the future", () => {
    expect(isImplausibleBirthDate("2030-01-01", NOW)).toBe(true);
  });

  it("flags an impossible age", () => {
    expect(isImplausibleBirthDate("1850-01-01", NOW)).toBe(true);
  });

  it("accepts a real one", () => {
    expect(isImplausibleBirthDate("1988-03-14", NOW)).toBe(false);
  });
});
