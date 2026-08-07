/**
 * Dates are where a spreadsheet import corrupts a chart without anybody
 * noticing. `03/04/1985` is a valid date under both readings, so a parser that
 * "just picks" pt-BR gets twelve rows a year silently wrong — and a wrong
 * birth date is not recoverable from the imported data.
 *
 * So the order is decided PER COLUMN, from evidence across every value in it:
 * a single day above 12 proves day-first, a single month above 12 proves
 * month-first. When the column proves nothing (every value ambiguous) the
 * verdict says so and the caller must ASK. Nothing here guesses.
 */

export type DateOrder = "dmy" | "mdy" | "iso";

export type DateColumnVerdict = {
  order: DateOrder | null;
  /** True when the professional has to choose: the column cannot prove it. */
  ambiguous: boolean;
  reason: "iso" | "day_over_12" | "month_over_12" | "conflicting" | "no_evidence" | "empty";
  samples: number;
};

const ISO_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const PARTS_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;

/** Exports often carry "14/03/1988 00:00:00"; the time is noise here. */
function dateToken(value: string): string {
  return value.trim().split(/[\sT]/)[0] ?? "";
}

export function resolveDateOrder(values: string[]): DateColumnVerdict {
  const tokens = values.map(dateToken).filter((value) => value !== "");
  if (tokens.length === 0) {
    return { order: null, ambiguous: false, reason: "empty", samples: 0 };
  }

  const parseable = tokens.filter((token) => ISO_PATTERN.test(token) || PARTS_PATTERN.test(token));
  if (parseable.length > 0 && parseable.every((token) => ISO_PATTERN.test(token))) {
    return { order: "iso", ambiguous: false, reason: "iso", samples: parseable.length };
  }

  let firstOverTwelve = false;
  let secondOverTwelve = false;
  let considered = 0;

  for (const token of parseable) {
    const parts = PARTS_PATTERN.exec(token);
    if (!parts) continue;
    considered += 1;
    if (Number(parts[1]) > 12) firstOverTwelve = true;
    if (Number(parts[2]) > 12) secondOverTwelve = true;
  }

  if (considered === 0) {
    return { order: null, ambiguous: true, reason: "no_evidence", samples: 0 };
  }
  // Both readings are contradicted somewhere in the same column: the file is
  // internally inconsistent and no single order can be right for all of it.
  if (firstOverTwelve && secondOverTwelve) {
    return { order: null, ambiguous: true, reason: "conflicting", samples: considered };
  }
  if (firstOverTwelve) {
    return { order: "dmy", ambiguous: false, reason: "day_over_12", samples: considered };
  }
  if (secondOverTwelve) {
    return { order: "mdy", ambiguous: false, reason: "month_over_12", samples: considered };
  }
  return { order: null, ambiguous: true, reason: "no_evidence", samples: considered };
}

/**
 * Two-digit years: a birth date reads backwards from today, so "85" is 1985
 * and "05" is 2005. The pivot is the current year, not a fixed constant.
 */
function expandYear(raw: string, now: Date): number {
  const year = Number(raw);
  if (raw.length === 4) return year;
  const currentTwoDigit = now.getUTCFullYear() % 100;
  return year <= currentTwoDigit ? 2000 + year : 1900 + year;
}

function toIsoIfReal(year: number, month: number, day: number): string | null {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-trip rejects 31/02 and friends, which Date would otherwise roll over
  // into March — turning an obvious typo into a plausible wrong date.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateValue(value: string, order: DateOrder, now = new Date()): string | null {
  const token = dateToken(value);
  if (token === "") return null;

  const iso = ISO_PATTERN.exec(token);
  if (iso) return toIsoIfReal(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (order === "iso") return null;

  const parts = PARTS_PATTERN.exec(token);
  if (!parts) return null;

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = expandYear(parts[3] ?? "", now);
  return order === "dmy" ? toIsoIfReal(year, second, first) : toIsoIfReal(year, first, second);
}

/**
 * A date that parsed but cannot be a birth date. Kept separate from parsing so
 * the value is still imported and merely flagged — it is her data, and a
 * warning she can act on beats a field silently dropped.
 */
export function isImplausibleBirthDate(iso: string, now = new Date()): boolean {
  const value = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return true;
  if (value.getTime() > now.getTime()) return true;
  return now.getUTCFullYear() - value.getUTCFullYear() > 120;
}
