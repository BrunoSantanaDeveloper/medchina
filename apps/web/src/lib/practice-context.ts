export const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Cuiaba",
  "America/Fortaleza",
  "America/Manaus",
  "America/Porto_Velho",
  "America/Recife",
  "Europe/Lisbon",
  "UTC",
] as const;

export const PRACTICE_MODALITIES = ["acupuncture", "diet", "moxibustion", "auriculotherapy", "cupping"] as const;

export type PracticeModality = (typeof PRACTICE_MODALITIES)[number];

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// ---------- Modalities beyond the five (migration 0119) ----------
//
// The five slugs above have clinical effect: they bound the therapeutic plan
// and orient the library. What she types beyond them has NONE — it is stored in
// its own column (`profiles.practice_modalities_other`), shown back to her and
// read by the platform team. It is never sent to a model.
//
// The limits mirror `practice_modalities_other_valid` in SQL. The database is
// the authority (the column carries a CHECK); these exist so she is told why a
// label was refused while she is still typing it.

export const PRACTICE_MODALITY_OTHER_MAX = 10;
export const PRACTICE_MODALITY_OTHER_MIN_LENGTH = 2;
export const PRACTICE_MODALITY_OTHER_MAX_LENGTH = 60;

export type OtherModalityIssue = "too_short" | "too_long" | "leading_symbol" | "too_many";

/** Trim, turn control characters and runs of whitespace into one space. */
export function cleanOtherModality(raw: string): string {
  return raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Why a cleaned label cannot be stored, or null when it can. */
export function otherModalityIssue(value: string): OtherModalityIssue | null {
  // Code points, like Postgres `char_length` — not UTF-16 units.
  const length = [...value].length;
  if (length < PRACTICE_MODALITY_OTHER_MIN_LENGTH) return "too_short";
  if (length > PRACTICE_MODALITY_OTHER_MAX_LENGTH) return "too_long";
  // The first character a spreadsheet reads as a formula. This list will be
  // exported by whoever studies it.
  if (/^[=+@-]/.test(value)) return "leading_symbol";
  return null;
}

/**
 * Same result as `normalize_practice_modalities_other` (0119): cleaned, empties
 * and the five slugs dropped, the FIRST spelling of a case-insensitive repeat
 * kept, in the order she typed them.
 */
export function normalizeOtherModalities(entries: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries ?? []) {
    if (typeof entry !== "string") continue;
    const value = cleanOtherModality(entry);
    const key = value.toLowerCase();
    if (!value || seen.has(key) || (PRACTICE_MODALITIES as readonly string[]).includes(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Mn}+/gu, "")
    .toLowerCase()
    .trim();

/**
 * The product modality a typed label refers to, if any — "Acupuntura",
 * "acupuntura " and "acupuncture" are all the canonical one. Without this the
 * free field would let her declare a known modality as an "other", where it
 * has no effect on the plan she expects it to shape.
 */
export function matchPracticeModality(
  typed: string,
  labels: Readonly<Record<PracticeModality, string>>,
): PracticeModality | null {
  const needle = fold(typed);
  if (!needle) return null;
  return PRACTICE_MODALITIES.find((slug) => slug === needle || fold(labels[slug]) === needle) ?? null;
}

// ---------- The practice timezone, without a field of its own ----------
//
// The workspace is born on America/Sao_Paulo and the onboarding used to OPEN
// by asking her to confirm it — a developer's question on the first screen of
// a clinical product. The browser already knows the answer:
//
//   * it keeps the same clock as the stored zone  → adopt it, ask nothing;
//   * the clock differs (Manaus, Lisbon, a VPN)   → ask, because a silently
//     wrong zone moves every appointment in her agenda;
//   * it was confirmed before                     → never asked again.

/** Minutes east of UTC for `timeZone` at `at`, or null when the zone is unknown. */
export function utcOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const wallClock = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
      read("second"),
    );
    if (Number.isNaN(wallClock)) return null;
    return Math.round((wallClock - at.getTime()) / 60_000);
  } catch {
    return null;
  }
}

const HALF_YEAR_MS = 182 * 24 * 60 * 60 * 1000;

/**
 * Do two zones show the same time today AND half a year from now? The second
 * sample is what separates "same offset this month" from "same clock": two
 * zones that only agree while one of them is on daylight time are not the same.
 */
export function sameClock(a: string, b: string, now: Date): boolean {
  const later = new Date(now.getTime() + HALF_YEAR_MS);
  const [aNow, bNow, aLater, bLater] = [
    utcOffsetMinutes(a, now),
    utcOffsetMinutes(b, now),
    utcOffsetMinutes(a, later),
    utcOffsetMinutes(b, later),
  ];
  if (aNow === null || bNow === null || aLater === null || bLater === null) return false;
  return aNow === bNow && aLater === bLater;
}

/** What `complete_practice_scope` records about where the zone came from. */
export type TimezoneSource = "browser" | "default" | "chosen" | "kept";

export type TimezoneProposal =
  /** Confirmed before: nothing to decide. */
  | { kind: "kept"; timezone: string }
  /** Nothing to ask: the browser agrees with the stored clock, or offered nothing. */
  | { kind: "silent"; timezone: string; source: Extract<TimezoneSource, "browser" | "default"> }
  /** The clocks differ: she picks. The browser's zone is offered first. */
  | { kind: "ask"; browser: string; stored: string };

export function proposeTimezone({
  stored,
  confirmed,
  browser,
  now = new Date(),
}: {
  stored: string;
  confirmed: boolean;
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`, when the browser has one. */
  browser: string | null | undefined;
  now?: Date;
}): TimezoneProposal {
  if (confirmed) return { kind: "kept", timezone: stored };
  if (!browser || !isValidTimeZone(browser)) return { kind: "silent", timezone: stored, source: "default" };
  if (browser === stored) return { kind: "silent", timezone: stored, source: "browser" };
  // Same clock under another name (America/Recife vs America/Sao_Paulo): take
  // the browser's, which is the one that stays right if the two ever part ways.
  if (sameClock(browser, stored, now)) return { kind: "silent", timezone: browser, source: "browser" };
  return { kind: "ask", browser, stored };
}

/** The zone the browser reports, or null on an engine that reports none. */
export function browserTimeZone(): string | null {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * A zone as a person recognises it: the time it shows right now, and its name.
 * "13:32 · Horário do Amazonas" answers "is this my clock?" at a glance, which
 * "America/Manaus" never does.
 */
export function describeTimeZone(timeZone: string, locale: string, now: Date): { clock: string; name: string } {
  const city = (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  let clock = "";
  let name = city;
  try {
    clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(now);
  } catch {
    clock = "";
  }
  try {
    const generic = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    // Some engines answer a bare offset ("GMT-4") for zones they cannot name;
    // the city is the better label then.
    if (generic && !/^(GMT|UTC)/i.test(generic)) name = generic;
  } catch {
    name = city;
  }
  return { clock, name };
}
