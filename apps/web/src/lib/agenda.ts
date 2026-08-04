import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

import { whatsappDeepLink } from "@/lib/whatsapp-link";
import type { SupabaseClient } from "@supabase/supabase-js";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export type ScheduleConflict = {
  id: string;
  patientId: string;
  patientName: string;
  scheduledFor: string;
  durationMinutes: number;
};

/** Structured reason an appointment left the calendar (0041). */
export const CANCELLATION_CATEGORIES = ["patient", "no_show", "professional", "other"] as const;
export type CancellationCategory = (typeof CANCELLATION_CATEGORIES)[number];

export type AgendaMutationResult = {
  ok: boolean;
  code: string;
  consultationId?: string;
  status?: string;
  conflict?: ScheduleConflict;
  overrodeConflict?: boolean;
};

export type SaveAppointmentInput = {
  orgId: string;
  patientId: string;
  scheduledFor: string;
  durationMinutes: number;
  appointmentNote?: string;
  consultationId?: string;
  forceConflict?: boolean;
};

const failed = (code: string): AgendaMutationResult => ({ ok: false, code });

function parseRpcResult(value: unknown): AgendaMutationResult {
  if (!value || typeof value !== "object") return failed("unexpected_response");
  const row = value as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    code: typeof row.code === "string" ? row.code : "unexpected_response",
    consultationId: typeof row.consultationId === "string" ? row.consultationId : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    conflict: row.conflict && typeof row.conflict === "object" ? (row.conflict as ScheduleConflict) : undefined,
    overrodeConflict: Boolean(row.overrodeConflict),
  };
}

export async function saveAppointment(
  supabase: SupabaseClient,
  input: SaveAppointmentInput,
): Promise<AgendaMutationResult> {
  const { data, error } = await supabase.rpc("save_scheduled_consultation", {
    target_org: input.orgId,
    target_patient: input.patientId,
    target_start: input.scheduledFor,
    target_duration: input.durationMinutes,
    target_note: input.appointmentNote?.trim() || null,
    target_consultation: input.consultationId ?? null,
    force_conflict: input.forceConflict ?? false,
  });
  if (error) return failed(error.code || "save_failed");

  const result = parseRpcResult(data);
  return result;
}

export type SeriesConflict = { scheduledFor: string; conflict: ScheduleConflict };

export type SaveSeriesResult = {
  ok: boolean;
  code: string;
  createdCount: number;
  conflictCount: number;
  created: { consultationId: string; scheduledFor: string }[];
  conflicts: SeriesConflict[];
};

export type SaveSeriesInput = {
  orgId: string;
  patientId: string;
  /** ISO timestamps of every occurrence, already stepped in the practice timezone. */
  starts: string[];
  durationMinutes: number;
  appointmentNote?: string;
};

/**
 * Creates a weekly series as N INDEPENDENT appointments in one atomic RPC.
 * Conflicting occurrences are skipped and reported back — the professional
 * books those manually; there is deliberately no bulk conflict override.
 */
export async function saveAppointmentSeries(
  supabase: SupabaseClient,
  input: SaveSeriesInput,
): Promise<SaveSeriesResult> {
  const failure = (code: string): SaveSeriesResult => ({
    ok: false,
    code,
    createdCount: 0,
    conflictCount: 0,
    created: [],
    conflicts: [],
  });

  const { data, error } = await supabase.rpc("save_scheduled_series", {
    target_org: input.orgId,
    target_patient: input.patientId,
    target_starts: input.starts,
    target_duration: input.durationMinutes,
    target_note: input.appointmentNote?.trim() || null,
  });
  if (error) return failure(error.code || "save_failed");
  if (!data || typeof data !== "object") return failure("unexpected_response");

  const row = data as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    code: typeof row.code === "string" ? row.code : "unexpected_response",
    createdCount: typeof row.createdCount === "number" ? row.createdCount : 0,
    conflictCount: typeof row.conflictCount === "number" ? row.conflictCount : 0,
    created: Array.isArray(row.created) ? (row.created as SaveSeriesResult["created"]) : [],
    conflicts: Array.isArray(row.conflicts) ? (row.conflicts as SeriesConflict[]) : [],
  };
}

export async function startAppointment(
  supabase: SupabaseClient,
  orgId: string,
  consultationId: string,
): Promise<AgendaMutationResult> {
  const { data, error } = await supabase.rpc("start_scheduled_consultation", {
    target_consultation: consultationId,
  });
  if (error) return failed(error.code || "start_failed");
  const result = parseRpcResult(data);
  void orgId;
  return result;
}

export async function cancelAppointment(
  supabase: SupabaseClient,
  orgId: string,
  consultationId: string,
  reason?: string,
  category?: CancellationCategory,
): Promise<AgendaMutationResult> {
  const { data, error } = await supabase.rpc("cancel_scheduled_consultation", {
    target_consultation: consultationId,
    reason: reason?.trim() || null,
    category: category ?? null,
  });
  if (error) return failed(error.code || "cancel_failed");
  const result = parseRpcResult(data);
  void orgId;
  return result;
}

export async function restoreAppointment(
  supabase: SupabaseClient,
  orgId: string,
  consultationId: string,
  forceConflict = false,
): Promise<AgendaMutationResult> {
  const { data, error } = await supabase.rpc("restore_cancelled_consultation", {
    target_consultation: consultationId,
    force_conflict: forceConflict,
  });
  if (error) return failed(error.code || "restore_failed");
  const result = parseRpcResult(data);
  void orgId;
  return result;
}

const calendarKey = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

export function calendarDayRange(
  day: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): {
  start: Date;
  end: Date;
} {
  const start = dayjs.tz(calendarKey(day), timeZone).startOf("day");
  return { start: start.toDate(), end: start.add(1, "day").startOf("day").toDate() };
}

/**
 * Window for the upcoming list: the whole of today in the office timezone through
 * `days` ahead. It starts at midnight, not at `from`, so today's earlier
 * appointments stay visible as context instead of vanishing as the day passes.
 */
export function calendarUpcomingRange(
  from: Date,
  days: number,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): {
  start: Date;
  end: Date;
} {
  const start = dayjs.tz(calendarKey(calendarDateInTimeZone(from, timeZone)), timeZone).startOf("day");
  return { start: start.toDate(), end: start.add(days, "day").startOf("day").toDate() };
}

/**
 * The calendar week that CONTAINS `anchor`, in the office timezone. Weeks start
 * on Monday (ISO), matching how a clinic reads its week. `anchor` is a local
 * calendar Date (from the day-navigation state), so only its Y/M/D matter.
 */
export function calendarWeekRange(
  anchor: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { start: Date; end: Date } {
  const day = dayjs.tz(calendarKey(anchor), timeZone).startOf("day");
  // dayjs day(): 0=Sunday..6=Saturday. Shift so Monday is the first day.
  const mondayOffset = (day.day() + 6) % 7;
  const start = day.subtract(mondayOffset, "day");
  return { start: start.toDate(), end: start.add(7, "day").toDate() };
}

/** The calendar month that CONTAINS `anchor`, in the office timezone. */
export function calendarMonthRange(
  anchor: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { start: Date; end: Date } {
  const start = dayjs.tz(calendarKey(anchor), timeZone).startOf("month");
  return { start: start.toDate(), end: start.add(1, "month").startOf("day").toDate() };
}

export function calendarDateInTimeZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day));
}

export function defaultAppointmentStart(
  day: Date,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Date {
  const dayKey = calendarKey(day);
  const officeNow = dayjs(now).tz(timeZone);
  const sameDay = dayKey === officeNow.format("YYYY-MM-DD");
  if (sameDay) {
    return officeNow.add(1, "hour").startOf("hour").toDate();
  }
  return dayjs.tz(`${dayKey}T09:00:00`, timeZone).toDate();
}

/**
 * Weekly occurrences for a series: the first is `startAt` itself, each next one
 * keeps the same WALL-CLOCK time in the practice timezone one week later.
 * Stepping is done on the CALENDAR date and rebuilt in the timezone — a dayjs
 * `.add(7, "day")` on a tz object adds exact 168h, which drifts the wall clock
 * across a DST change.
 */
export function weeklyOccurrences(startAt: string | Date, count: number, timeZone: string): Date[] {
  const first = dayjs(startAt).tz(timeZone);
  const datePart = first.format("YYYY-MM-DD");
  const timePart = first.format("HH:mm:ss");
  return Array.from({ length: Math.max(count, 1) }, (_, index) => {
    if (index === 0) return first.toDate();
    const stepped = new Date(`${datePart}T00:00:00Z`);
    stepped.setUTCDate(stepped.getUTCDate() + index * 7);
    return dayjs.tz(`${stepped.toISOString().slice(0, 10)}T${timePart}`, timeZone).toDate();
  });
}

/**
 * Window for "appointments left behind": every practice day BEFORE today,
 * bounded so the query never scans unlimited history. Today's own appointments
 * are excluded on purpose — they are visible right in the day view.
 */
export function calendarOverdueRange(
  now: Date,
  lookbackDays: number,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { start: Date; end: Date } {
  const todayStart = dayjs.tz(calendarKey(calendarDateInTimeZone(now, timeZone)), timeZone).startOf("day");
  return { start: todayStart.subtract(lookbackDays, "day").toDate(), end: todayStart.toDate() };
}

/**
 * wa.me deep link with a prefilled confirmation message, or null when the
 * stored phone cannot be a reachable Brazilian WhatsApp number.
 *
 * The link building now lives in `lib/whatsapp-link.ts`, shared with document
 * delivery — every WhatsApp path in this product is a handoff the professional
 * completes herself, so they must behave identically.
 */
export function whatsappConfirmationLink(phone: string | null | undefined, message: string): string | null {
  return whatsappDeepLink(phone, message);
}
