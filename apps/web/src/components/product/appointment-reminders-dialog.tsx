"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, Skeleton, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiPhoneHandset from "@/icons/nexture/ni-phone-handset";
import { calendarDayRange } from "@/lib/agenda";
import { buildReminderRun, type ReminderAppointment, type ReminderRun } from "@/lib/appointment-reminders";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

/**
 * Tomorrow's reminder run — the lever against no-show, which the agenda has
 * measured all along without offering.
 *
 * There is no automated WhatsApp here (the Meta API needs business
 * verification, template approval and charges per message). So this is an
 * ASSISTED run, and its design follows from that honestly:
 *
 *  - one row per patient, in time order, each with a real anchor that opens
 *    WhatsApp with the message already written — a scripted `window.open` in a
 *    loop would be eaten by the popup blocker and would spray eight tabs at
 *    her anyway;
 *  - opening a row marks it, so a run interrupted at patient four resumes at
 *    four instead of starting over — and the mark is stored, so it survives
 *    closing the dialog;
 *  - the mark says "marcado", never "entregue": the app hands off to WhatsApp
 *    and never learns whether she pressed send. She can unmark it;
 *  - patients with no reachable number are LISTED, not hidden — those are
 *    exactly the ones she has to remember to phone.
 */
export default function AppointmentRemindersDialog({
  open,
  onClose,
  orgId,
  day,
  timezone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  /** The day being reminded about (usually tomorrow). */
  day: Date;
  timezone: string;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [state, setState] = useState<RemoteState<ReminderRun, "load_failed">>(() => remoteLoading());
  const [busyId, setBusyId] = useState<string | null>(null);

  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: timezone,
  }).format(day);

  const load = useCallback(async () => {
    if (!orgId || !isSupabaseConfigured) {
      setState(remoteError("load_failed"));
      return;
    }
    setState(remoteLoading());
    const { start, end } = calendarDayRange(day, timezone);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("consultations")
      .select("id, status, scheduled_for, reminder_marked_at, patient_id, patients(full_name, phone)")
      .eq("org_id", orgId)
      .eq("status", "scheduled")
      .gte("scheduled_for", start.toISOString())
      .lt("scheduled_for", end.toISOString())
      .order("scheduled_for");
    if (error) {
      setState(remoteError("load_failed"));
      return;
    }

    const appointments: ReminderAppointment[] = (data ?? []).map((row) => {
      const patient = row.patients as unknown as { full_name?: string; phone?: string | null } | null;
      return {
        id: row.id as string,
        status: row.status as string,
        scheduledFor: row.scheduled_for as string,
        patientName: patient?.full_name ?? "—",
        patientPhone: patient?.phone ?? null,
        reminderMarkedAt: (row.reminder_marked_at as string | null) ?? null,
      };
    });

    setState(remoteSuccess(buildReminderRun(appointments, messageFor)));
    // `messageFor` closes over t/locale/timezone, all stable for a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, day, timezone, locale]);

  const messageFor = (appointment: ReminderAppointment) =>
    t("reminders-message", {
      name: appointment.patientName.trim().split(" ")[0] ?? "",
      date: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: timezone }).format(
        new Date(appointment.scheduledFor),
      ),
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(
        new Date(appointment.scheduledFor),
      ),
    });

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const setMarked = async (consultationId: string, marked: boolean) => {
    setBusyId(consultationId);
    try {
      const supabase = createClient();
      await supabase.rpc("mark_appointment_reminder", {
        target_consultation: consultationId,
        target_marked: marked,
      });
      await load();
    } catch {
      // The mark is bookkeeping for her own run; a failure here must not stop
      // her from carrying on with the next patient.
    } finally {
      setBusyId(null);
    }
  };

  const run = state.status === "success" ? state.data : undefined;
  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogHeader title={t("reminders-title")} closeLabel={t("close")} onClose={onClose} />
      <DialogContent className="flex flex-col gap-3 py-5!">
        <Typography variant="body2" className="text-text-secondary leading-6">
          {t("reminders-subtitle", { day: dayLabel })}
        </Typography>

        {state.status === "loading" && (
          <Box className="flex flex-col gap-2">
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Box>
        )}

        {state.status === "error" && (
          <Alert severity="error" action={<Button onClick={() => void load()}>{t("retry")}</Button>}>
            {t("reminders-load-error")}
          </Alert>
        )}

        {run && run.targets.length === 0 && run.unreachable.length === 0 && (
          <Alert severity="info">{t("reminders-empty")}</Alert>
        )}

        {run && run.targets.length > 0 && (
          <>
            <Typography variant="body2" className="text-text-primary text-xs font-semibold">
              {t("reminders-progress", { pending: run.pendingCount, total: run.targets.length })}
            </Typography>
            <Box className="flex flex-col gap-1.5">
              {run.targets.map((target) => (
                <Box
                  key={target.appointment.id}
                  className={cn(
                    "border-grey-100 flex flex-row flex-wrap items-center gap-2 rounded-2xl border px-3 py-2",
                    target.marked && "bg-grey-100/60",
                  )}
                >
                  <Box className="min-w-0 flex-1">
                    <Typography variant="body2" className="text-text-primary text-sm font-medium">
                      {timeOf(target.appointment.scheduledFor)} · {target.appointment.patientName}
                    </Typography>
                    {target.marked && (
                      <Typography variant="body2" className="text-text-secondary flex items-center gap-1 text-xs">
                        <NiCheckSquare size="tiny" aria-hidden />
                        {t("reminders-marked")}
                      </Typography>
                    )}
                  </Box>

                  {/* A real anchor: the click that leaves for WhatsApp is HERS,
                      so no popup blocker eats it and the device can hand off to
                      the installed app. Marking happens on the same click. */}
                  <Button
                    size="small"
                    variant={target.marked ? "text" : "contained"}
                    color={target.marked ? "grey" : "primary"}
                    href={target.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (!target.marked) void setMarked(target.appointment.id, true);
                    }}
                  >
                    {target.marked ? t("reminders-open-again") : t("reminders-open")}
                  </Button>
                  {target.marked && (
                    <Button
                      size="small"
                      variant="text"
                      color="grey"
                      disabled={busyId === target.appointment.id}
                      onClick={() => void setMarked(target.appointment.id, false)}
                    >
                      {busyId === target.appointment.id ? (
                        <CircularProgress size={14} aria-label={t("loading")} />
                      ) : (
                        t("reminders-unmark")
                      )}
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          </>
        )}

        {/* Never hidden: a patient with no WhatsApp is the one she must call. */}
        {run && run.unreachable.length > 0 && (
          <Box className="flex flex-col gap-1.5">
            <Typography variant="body2" className="text-text-primary flex items-center gap-1 text-xs font-semibold">
              <NiPhoneHandset size="tiny" aria-hidden />
              {t("reminders-unreachable-title")}
            </Typography>
            {run.unreachable.map((appointment) => (
              <Typography key={appointment.id} variant="body2" className="text-text-secondary text-xs leading-5">
                {timeOf(appointment.scheduledFor)} · {appointment.patientName}
              </Typography>
            ))}
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("reminders-unreachable-hint")}
            </Typography>
          </Box>
        )}

        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("reminders-privacy")}
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
