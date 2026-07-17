"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Skeleton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ScheduleDialog, { type ScheduleSeed } from "@/components/product/schedule-dialog";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChevronLeft from "@/icons/nexture/ni-chevron-left";
import NiChevronRight from "@/icons/nexture/ni-chevron-right";
import {
  calendarDateInTimeZone,
  calendarDayRange,
  calendarUpcomingRange,
  cancelAppointment,
  defaultAppointmentStart,
  restoreAppointment,
  startAppointment,
} from "@/lib/agenda";
import { cn } from "@/lib/utils";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type Appointment = {
  id: string;
  status: string;
  scheduledFor: string;
  durationMinutes: number;
  appointmentNote: string | null;
  cancellationReason: string | null;
  patientId: string;
  patientName: string;
};

/** How far the "upcoming" list looks ahead. */
const UPCOMING_DAYS = 30;

type AgendaView = "day" | "upcoming";

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const moveDay = (day: Date, amount: number) => {
  const next = new Date(day);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
};

export default function Agenda() {
  const t = useTranslations("product");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();
  const { orgId, timezone, loading: orgLoading } = useCurrentOrg();
  const requestId = useRef(0);
  const openedIntent = useRef(false);
  const [view, setView] = useState<AgendaView>("day");
  const [patientFilter, setPatientFilter] = useState("");
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [appointmentsState, setAppointmentsState] = useState<RemoteState<Appointment[], string>>(() => remoteLoading());
  const [showCancelled, setShowCancelled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seed, setSeed] = useState<ScheduleSeed | undefined>();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!orgLoading) setDay(calendarDateInTimeZone(new Date(), timezone));
  }, [orgLoading, timezone]);

  const load = useCallback(async () => {
    if (orgLoading) return;
    if (!orgId) {
      setAppointmentsState(remoteError(t("agenda-no-workspace")));
      return;
    }

    const currentRequest = ++requestId.current;
    setAppointmentsState(remoteLoading());
    const supabase = createClient();
    const { start, end } =
      view === "upcoming"
        ? calendarUpcomingRange(new Date(), UPCOMING_DAYS, timezone)
        : calendarDayRange(day, timezone);
    let query = supabase
      .from("consultations")
      .select(
        "id, status, scheduled_for, duration_minutes, appointment_note, cancellation_reason, patient_id, patients(full_name)",
      )
      .eq("org_id", orgId)
      .gte("scheduled_for", start.toISOString())
      .lt("scheduled_for", end.toISOString())
      .order("scheduled_for", { ascending: true });
    // Cancelled appointments are a day-view audit detail; the upcoming list is
    // about what still stands, so it never shows them.
    query = view === "day" && showCancelled ? query.eq("status", "cancelled") : query.neq("status", "cancelled");
    const { data, error } = await query;

    if (currentRequest !== requestId.current) return;
    if (error) {
      setAppointmentsState(remoteError(t("agenda-load-error")));
      return;
    }

    const appointments = (data ?? []).map((row) => {
      const patient = row.patients as unknown as { full_name: string } | null;
      return {
        id: row.id as string,
        status: row.status as string,
        scheduledFor: row.scheduled_for as string,
        durationMinutes: row.duration_minutes as number,
        appointmentNote: (row.appointment_note as string | null) ?? null,
        cancellationReason: (row.cancellation_reason as string | null) ?? null,
        patientId: row.patient_id as string,
        patientName: patient?.full_name ?? t("patient-unknown"),
      };
    });
    setAppointmentsState(appointments.length === 0 ? remoteEmpty() : remoteSuccess(appointments));
  }, [day, orgId, orgLoading, showCancelled, t, timezone, view]);

  useEffect(() => {
    load();
  }, [load]);

  const openNewSchedule = () => {
    setSeed({ startAt: defaultAppointmentStart(day, new Date(), timezone).toISOString() });
    setDialogOpen(true);
  };

  useEffect(() => {
    if (openedIntent.current || searchParams.get("new") !== "1") return;
    openedIntent.current = true;
    const patientId = searchParams.get("patientId") ?? undefined;
    setSeed({ startAt: defaultAppointmentStart(day, new Date(), timezone).toISOString(), patientId });
    setDialogOpen(true);
    router.replace("/agenda", { scroll: false });
  }, [day, router, searchParams, timezone]);

  const openConsultation = async (appointment: Appointment) => {
    if (!orgId || openingId) return;
    setOpeningId(appointment.id);
    if (appointment.status === "scheduled") {
      const result = await startAppointment(createClient(), orgId, appointment.id);
      if (!result.ok) {
        setOpeningId(null);
        if (result.code === "active_consultation_exists" && result.consultationId) {
          enqueueSnackbar(t("agenda-active-consultation-exists"), { variant: "info" });
          router.push(`/consultas/${result.consultationId}`);
          return;
        }
        enqueueSnackbar(t("agenda-start-error"), { variant: "error" });
        await load();
        return;
      }
    }
    router.push(`/consultas/${appointment.id}`);
  };

  const confirmCancel = async () => {
    if (!orgId || !cancelTarget || cancelling) return;
    setCancelling(true);
    const target = cancelTarget;
    const result = await cancelAppointment(createClient(), orgId, target.id, cancelReason);
    setCancelling(false);
    if (!result.ok) {
      enqueueSnackbar(t("agenda-cancel-error"), { variant: "error" });
      setCancelTarget(null);
      await load();
      return;
    }

    setCancelTarget(null);
    setCancelReason("");
    await load();
    enqueueSnackbar(t("agenda-cancel-success", { patient: target.patientName }), {
      variant: "success",
      action: (snackbarId) => (
        <Button
          color="inherit"
          size="small"
          onClick={async () => {
            closeSnackbar(snackbarId);
            await restore(target);
          }}
        >
          {t("undo")}
        </Button>
      ),
    });
  };

  const restore = async (appointment: Appointment, forceConflict = false) => {
    if (!orgId) return;
    const result = await restoreAppointment(createClient(), orgId, appointment.id, forceConflict);
    if (result.ok) enqueueSnackbar(t("agenda-restore-success"), { variant: "success" });
    else if (result.code === "schedule_conflict" && !forceConflict)
      enqueueSnackbar(t("agenda-restore-conflict"), {
        variant: "warning",
        action: (snackbarId) => (
          <Button
            color="inherit"
            size="small"
            onClick={async () => {
              closeSnackbar(snackbarId);
              await restore(appointment, true);
            }}
          >
            {t("agenda-restore-anyway")}
          </Button>
        ),
      });
    else enqueueSnackbar(t("agenda-restore-error"), { variant: "error" });
    await load();
  };

  const officeToday = calendarDateInTimeZone(new Date(), timezone);
  const today = isSameDay(day, officeToday);
  const dayLabel = day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  // Appointments are grouped by the day they fall on IN THE OFFICE timezone, so a
  // late consultation never drifts into the neighbouring day of the viewer's clock.
  const officeDayKey = (instant: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  const localDayKey = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

  const query = patientFilter.trim().toLowerCase();
  const visibleAppointments =
    appointmentsState.status === "success"
      ? appointmentsState.data.filter(
          (appointment) => view === "day" || !query || appointment.patientName.toLowerCase().includes(query),
        )
      : [];

  const upcomingGroups = () => {
    const groups = new Map<string, Appointment[]>();
    for (const appointment of visibleAppointments) {
      const key = officeDayKey(new Date(appointment.scheduledFor));
      const bucket = groups.get(key);
      if (bucket) bucket.push(appointment);
      else groups.set(key, [appointment]);
    }
    return [...groups.entries()];
  };

  const groupLabel = (key: string) => {
    const [year, month, date] = key.split("-").map(Number);
    const formatted = new Date(year, month - 1, date).toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (key === localDayKey(officeToday)) return `${t("agenda-upcoming-today")} · ${formatted}`;
    if (key === localDayKey(moveDay(officeToday, 1))) return `${t("agenda-upcoming-tomorrow")} · ${formatted}`;
    return formatted;
  };

  const timeRange = (appointment: Appointment) => {
    const start = new Date(appointment.scheduledFor);
    const end = new Date(start.getTime() + appointment.durationMinutes * 60_000);
    const fmt = (value: Date) =>
      value.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone });
    return `${fmt(start)} – ${fmt(end)}`;
  };

  const renderAppointment = (appointment: Appointment) => {
    const isScheduled = appointment.status === "scheduled";
    const isFinalized = appointment.status === "finalized";
    const isCancelled = appointment.status === "cancelled";
    return (
      <Card
        key={appointment.id}
        component="section"
        aria-label={`${appointment.patientName}, ${timeRange(appointment)}`}
      >
        <CardContent className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <Box className="flex min-w-0 flex-col gap-1">
            <Box className="flex flex-row flex-wrap items-center gap-2">
              <Typography variant="body1" className="text-text-primary font-semibold tabular-nums">
                {timeRange(appointment)}
              </Typography>
              {statusChip(appointment.status)}
            </Box>
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {appointment.patientName}
            </Typography>
            {appointment.appointmentNote && (
              <Typography variant="body2" className="text-text-secondary truncate text-xs">
                {appointment.appointmentNote}
              </Typography>
            )}
            {isCancelled && appointment.cancellationReason && (
              <Typography variant="body2" className="text-text-secondary text-xs">
                {t("agenda-cancellation-reason", { reason: appointment.cancellationReason })}
              </Typography>
            )}
          </Box>
          <Box className="flex flex-row flex-wrap gap-2">
            {isCancelled ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                onClick={() => restore(appointment)}
                aria-label={t("agenda-restore-for", { patient: appointment.patientName })}
              >
                {t("agenda-restore")}
              </Button>
            ) : (
              <Button
                variant={isScheduled ? "contained" : "outlined"}
                color={isScheduled ? "primary" : "grey"}
                size="small"
                disabled={openingId === appointment.id}
                onClick={() => openConsultation(appointment)}
                aria-label={t("agenda-open-for", { patient: appointment.patientName })}
              >
                {isScheduled ? t("agenda-start") : isFinalized ? t("agenda-view") : t("agenda-open")}
              </Button>
            )}
            {isScheduled && (
              <>
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  aria-label={t("agenda-reschedule-for", { patient: appointment.patientName })}
                  onClick={() => {
                    setSeed({
                      consultationId: appointment.id,
                      patientId: appointment.patientId,
                      startAt: appointment.scheduledFor,
                      durationMinutes: appointment.durationMinutes,
                      appointmentNote: appointment.appointmentNote ?? undefined,
                    });
                    setDialogOpen(true);
                  }}
                >
                  {t("agenda-reschedule")}
                </Button>
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  aria-label={t("agenda-cancel-for", { patient: appointment.patientName })}
                  onClick={() => {
                    setCancelTarget(appointment);
                    setCancelReason("");
                  }}
                >
                  {t("agenda-cancel-appointment")}
                </Button>
              </>
            )}
          </Box>
        </CardContent>
      </Card>
    );
  };

  const statusChip = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      scheduled: {
        label: t("agenda-status-scheduled"),
        className: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
      },
      in_progress: { label: t("agenda-status-in-progress"), className: "bg-primary/15 text-primary" },
      awaiting_review: {
        label: t("agenda-status-awaiting"),
        className: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
      },
      draft: { label: t("agenda-status-draft"), className: "bg-grey-100 text-text-secondary" },
      finalized: {
        label: t("agenda-status-finalized"),
        className: "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
      },
      cancelled: { label: t("status-cancelled"), className: "bg-grey-100 text-text-secondary" },
    };
    const chip = map[status] ?? { label: status, className: "bg-grey-100 text-text-secondary" };
    return <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", chip.className)}>{chip.label}</span>;
  };

  return (
    <Grid container spacing={5}>
      <Grid size={12} className="flex flex-row flex-wrap items-start justify-between gap-3">
        <Box>
          <Typography variant="h1" component="h1" className="mb-0">
            {t("agenda-title")}
          </Typography>
          <Breadcrumbs>
            <Typography variant="body2">{t("agenda-breadcrumb")}</Typography>
          </Breadcrumbs>
        </Box>
        <Button variant="contained" color="primary" onClick={openNewSchedule} disabled={!orgId || orgLoading}>
          {t("agenda-schedule")}
        </Button>
      </Grid>

      <Grid size={12}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          aria-label={t("agenda-view-label")}
          onChange={(_, next: AgendaView | null) => {
            if (!next) return;
            setView(next);
            setPatientFilter("");
          }}
        >
          <ToggleButton value="day">{t("agenda-view-day")}</ToggleButton>
          <ToggleButton value="upcoming">{t("agenda-view-upcoming")}</ToggleButton>
        </ToggleButtonGroup>
      </Grid>

      {view === "day" && (
        <Grid size={12}>
          <Card component="section" aria-label={t("agenda-day-navigation")}>
            <CardContent className="flex flex-row items-center justify-between gap-2 py-3!">
              <IconButton aria-label={t("agenda-prev-day")} onClick={() => setDay((current) => moveDay(current, -1))}>
                <NiChevronLeft size="medium" />
              </IconButton>
              <Box className="flex flex-col items-center" aria-live="polite">
                <Typography variant="h6" component="p" className="mb-0 capitalize">
                  {dayLabel}
                </Typography>
                {!today ? (
                  <Button variant="text" color="grey" size="small" onClick={() => setDay(officeToday)}>
                    {t("agenda-today")}
                  </Button>
                ) : (
                  <Typography variant="body2" className="text-primary text-xs font-semibold">
                    {t("agenda-today")}
                  </Typography>
                )}
              </Box>
              <IconButton aria-label={t("agenda-next-day")} onClick={() => setDay((current) => moveDay(current, 1))}>
                <NiChevronRight size="medium" />
              </IconButton>
            </CardContent>
          </Card>
        </Grid>
      )}

      {view === "upcoming" && (
        <Grid size={12}>
          <TextField
            fullWidth
            size="small"
            label={t("agenda-upcoming-filter")}
            placeholder={t("agenda-upcoming-filter-hint")}
            value={patientFilter}
            onChange={(event) => setPatientFilter(event.target.value)}
          />
        </Grid>
      )}

      {view === "day" && (
        <Grid size={12} className="flex justify-end">
          <Button variant="text" color="grey" size="small" onClick={() => setShowCancelled((current) => !current)}>
            {showCancelled ? t("agenda-show-active") : t("agenda-show-cancelled")}
          </Button>
        </Grid>
      )}

      <Grid size={12}>
        {appointmentsState.status === "error" ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={load}>
                {t("retry")}
              </Button>
            }
          >
            {appointmentsState.error}
          </Alert>
        ) : appointmentsState.status === "idle" || appointmentsState.status === "loading" ? (
          <Box className="flex flex-col gap-3" aria-label={t("loading")}>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} variant="rounded" height={92} className="rounded-3xl" />
            ))}
          </Box>
        ) : appointmentsState.status === "empty" || visibleAppointments.length === 0 ? (
          <Card component="section">
            <CardContent>
              {/* A search that matches nothing is a different answer from an empty agenda:
                  it must offer a way back, never the "schedule one" nudge. */}
              {view === "upcoming" && query ? (
                <EmptyState
                  icon={<NiCalendarClock />}
                  title={t("agenda-upcoming-no-match-title")}
                  description={t("agenda-upcoming-no-match-body", { patient: patientFilter.trim() })}
                  action={{ label: t("agenda-upcoming-clear-filter"), onClick: () => setPatientFilter("") }}
                />
              ) : view === "upcoming" ? (
                <EmptyState
                  icon={<NiCalendarClock />}
                  title={t("agenda-upcoming-empty-title")}
                  description={t("agenda-upcoming-empty-body", { days: UPCOMING_DAYS })}
                  action={{ label: t("agenda-schedule"), onClick: openNewSchedule }}
                />
              ) : (
                <EmptyState
                  icon={<NiCalendarClock />}
                  title={showCancelled ? t("agenda-no-cancelled-title") : t("agenda-empty-title")}
                  description={
                    showCancelled
                      ? t("agenda-no-cancelled-body")
                      : today
                        ? t("agenda-empty-today")
                        : t("agenda-empty-day")
                  }
                  action={
                    showCancelled
                      ? { label: t("agenda-show-active"), onClick: () => setShowCancelled(false) }
                      : { label: t("agenda-schedule"), onClick: openNewSchedule }
                  }
                />
              )}
            </CardContent>
          </Card>
        ) : view === "upcoming" ? (
          <Box className="flex flex-col gap-6" aria-live="polite">
            {upcomingGroups().map(([key, appointments]) => (
              <Box key={key} className="flex flex-col gap-3">
                <Typography
                  variant="body2"
                  component="h2"
                  className="text-text-secondary mb-0 text-xs font-semibold tracking-wide uppercase"
                >
                  {groupLabel(key)}
                </Typography>
                {appointments.map(renderAppointment)}
              </Box>
            ))}
          </Box>
        ) : (
          <Box className="flex flex-col gap-3" aria-live="polite">
            {visibleAppointments.map(renderAppointment)}
          </Box>
        )}
      </Grid>

      {orgId && (
        <ScheduleDialog
          open={dialogOpen}
          orgId={orgId}
          timeZone={timezone}
          seed={seed}
          onClose={() => setDialogOpen(false)}
          onSaved={async (result) => {
            enqueueSnackbar(result.code === "updated" ? t("agenda-reschedule-success") : t("agenda-schedule-success"), {
              variant: "success",
            });
            await load();
          }}
        />
      )}

      <Dialog open={Boolean(cancelTarget)} onClose={() => !cancelling && setCancelTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("agenda-cancel-title")}</DialogTitle>
        <DialogContent className="flex flex-col gap-4 pt-2!">
          <Typography variant="body2" className="text-text-secondary">
            {cancelTarget
              ? t("agenda-cancel-body", { patient: cancelTarget.patientName, time: timeRange(cancelTarget) })
              : ""}
          </Typography>
          <TextField
            autoFocus
            label={t("agenda-cancel-reason")}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setCancelTarget(null)} disabled={cancelling}>
            {t("agenda-keep-appointment")}
          </Button>
          <Button variant="contained" color="error" onClick={confirmCancel} disabled={cancelling}>
            {cancelling ? t("saving") : t("agenda-confirm-cancel")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
