import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

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
): Promise<AgendaMutationResult> {
  const { data, error } = await supabase.rpc("cancel_scheduled_consultation", {
    target_consultation: consultationId,
    reason: reason?.trim() || null,
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
