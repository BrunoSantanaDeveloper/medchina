import { type DateOrder, parseDateValue } from "./dates";
import type { ColumnMapping, ExistingPatient, ImportPreview, ParsedTable, RowIssue, StagedRow } from "./types";

import { normalizePatientName } from "@/lib/patients";

/**
 * The dry-run for an AGENDA import: one line per appointment already booked.
 *
 * Everything here happens in the practice's WALL CLOCK, never in UTC. The
 * spreadsheet says "14:30" and means half past two where she works, so the
 * comparison space is naive local time: existing appointments are converted
 * from their instants INTO her timezone (the easy direction), and the actual
 * local→UTC conversion is left to the database, which knows the zone from the
 * organization row. Doing it here would be a second implementation of the same
 * arithmetic, and the two would disagree on exactly one day a year.
 *
 * Conflicts are surfaced now rather than at commit: an agenda import fails
 * mostly on slots that are already taken, and "23 refused" with no reasons is
 * not a preview.
 */

export type ExistingAppointment = { scheduledFor: string; durationMinutes: number | null };

export type SchedulePreviewInput = {
  table: ParsedTable;
  mapping: ColumnMapping;
  dateOrder?: DateOrder;
  existing: ExistingPatient[];
  appointments: ExistingAppointment[];
  /** IANA zone of the practice (organizations.timezone, 0036). */
  timeZone: string;
  now?: Date;
};

const HEADER_ROW_OFFSET = 2;
const DEFAULT_DURATION = 50;
const TIME_PATTERN = /(\d{1,2})[:h](\d{2})/;

/** An instant, as the wall clock reads it in her practice. */
export function localNaive(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Naive minutes: comparable only against other naive values, which is the point. */
export function naiveMinutes(naive: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(naive);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) / 60000;
}

function readTime(value: string): string | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function buildSchedulePreview({
  table,
  mapping,
  dateOrder,
  existing,
  appointments,
  timeZone,
  now = new Date(),
}: SchedulePreviewInput): ImportPreview {
  const byExternalRef = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const patient of existing) {
    if (patient.externalRef) byExternalRef.set(patient.externalRef, patient.id);
    const key = normalizePatientName(patient.fullName);
    if (key) byName.set(key, [...(byName.get(key) ?? []), patient.id]);
  }

  // The calendar as she sees it, in her own wall clock.
  const taken = appointments
    .map((appointment) => {
      const start = naiveMinutes(localNaive(new Date(appointment.scheduledFor), timeZone));
      return { start, end: start + Math.max(appointment.durationMinutes ?? DEFAULT_DURATION, 1) };
    })
    .filter((slot) => Number.isFinite(slot.start));

  const nowMinutes = naiveMinutes(localNaive(now, timeZone));
  const columnWarnings: RowIssue[] = [];
  if (mapping.date !== undefined && !dateOrder) {
    columnWarnings.push({ code: "date_order_unresolved", field: "date", header: table.headers[mapping.date] });
  }

  const seenExternalRef = new Set<string>();
  const rows: StagedRow[] = table.rows.map((row, index) => {
    const rowNumber = index + HEADER_ROW_OFFSET;
    const cell = (position?: number) => (position === undefined ? "" : (row[position] ?? "").trim());

    const raw: Record<string, string> = {};
    row.forEach((value, position) => {
      const header = table.headers[position]?.trim();
      raw[header && header !== "" ? header : `coluna_${position + 1}`] = value;
    });

    const warnings: RowIssue[] = [];
    const staged: StagedRow = {
      rowNumber,
      raw,
      normalized: {},
      action: "create",
      targetType: "consultation",
      warnings,
    };
    const refuse = (code: string): StagedRow => ({ ...staged, action: "error", errorCode: code, normalized: {} });

    const dateRaw = cell(mapping.date);
    if (dateRaw === "") return refuse("record_date_required");
    if (!dateOrder) return refuse("date_order_unresolved");
    const date = parseDateValue(dateRaw, dateOrder);
    if (!date) return refuse("date_not_recognized");

    // Exports put the time in its own column or glue it to the date; both are
    // common enough that refusing either would send her back to the spreadsheet.
    const time = readTime(cell(mapping.time)) ?? readTime(dateRaw.slice(10));
    if (!time) return refuse("time_required");

    const localDateTime = `${date}T${time}`;
    const startMinutes = naiveMinutes(localDateTime);
    if (startMinutes <= nowMinutes) return refuse("schedule_in_past");

    const durationRaw = cell(mapping.duration);
    let duration = DEFAULT_DURATION;
    if (durationRaw !== "") {
      const parsed = Number(durationRaw.replace(/\D+/g, ""));
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 1440) duration = parsed;
      else warnings.push({ code: "duration_not_recognized", field: "duration" });
    }

    const patientRef = cell(mapping.patient_ref);
    const patientName = cell(mapping.patient_name);
    let patientId = patientRef ? byExternalRef.get(patientRef) : undefined;
    if (!patientId && patientName) {
      const matches = byName.get(normalizePatientName(patientName)) ?? [];
      if (matches.length > 1) return refuse("patient_ambiguous");
      patientId = matches[0];
    }
    if (!patientId) return refuse("patient_not_found");

    const externalRef = cell(mapping.external_ref);
    if (externalRef && seenExternalRef.has(externalRef)) {
      return { ...staged, action: "skip", errorCode: "duplicate_in_file", normalized: {} };
    }

    const end = startMinutes + duration;
    if (taken.some((slot) => slot.start < end && startMinutes < slot.end)) {
      return refuse("schedule_conflict");
    }
    // Rows accepted earlier in this file occupy the calendar too — two lines
    // cannot book the same hour just because neither is saved yet.
    taken.push({ start: startMinutes, end });
    if (externalRef) seenExternalRef.add(externalRef);

    const note = cell(mapping.note);
    return {
      ...staged,
      normalized: {
        patient_id: patientId,
        local_datetime: localDateTime,
        duration: String(duration),
        ...(note ? { note } : {}),
        ...(externalRef ? { external_ref: externalRef } : {}),
      },
    };
  });

  const summary = { create: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) summary[row.action] += 1;

  return { rows, summary, columnWarnings };
}
