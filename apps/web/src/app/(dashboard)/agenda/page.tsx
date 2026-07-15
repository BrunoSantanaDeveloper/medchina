"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Box, Breadcrumbs, Button, Card, CardContent, Grid, IconButton, Skeleton, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ScheduleDialog, { type ScheduleSeed } from "@/components/product/schedule-dialog";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChevronLeft from "@/icons/nexture/ni-chevron-left";
import NiChevronRight from "@/icons/nexture/ni-chevron-right";
import { recordAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Appointment = {
  id: string;
  status: string;
  startedAt: string;
  durationMinutes: number;
  reason: string | null;
  patientId: string;
  patientName: string;
};

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const isSameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * The agenda (PRD §9.3). The job here is NOT "manage a table of appointments" —
 * it is: see this day at a glance and open the next patient. So the screen is a
 * time-ordered view of ONE day, with day-to-day navigation, and the primary
 * action is scheduling the next consultation. Opening a scheduled event is Modo
 * Consulta on the very same consultation row.
 */
export default function Agenda() {
  const t = useTranslations("product");
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seed, setSeed] = useState<ScheduleSeed | undefined>(undefined);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !isSupabaseConfigured) {
      setAppointments([]);
      return;
    }
    setAppointments(null);
    const supabase = createClient();
    const dayStart = day.toISOString();
    const dayEnd = new Date(day.getTime() + DAY_MS).toISOString();
    const { data } = await supabase
      .from("consultations")
      .select("id, status, started_at, duration_minutes, chief_complaint, patient_id, patients(full_name)")
      .eq("org_id", orgId)
      .gte("started_at", dayStart)
      .lt("started_at", dayEnd)
      .neq("status", "cancelled")
      .order("started_at", { ascending: true });

    setAppointments(
      (data ?? []).map((row) => {
        const patient = row.patients as unknown as { full_name: string } | null;
        return {
          id: row.id,
          status: row.status,
          startedAt: row.started_at,
          durationMinutes: row.duration_minutes,
          reason: row.chief_complaint,
          patientId: row.patient_id,
          patientName: patient?.full_name ?? "—",
        };
      }),
    );
  }, [orgId, day]);

  useEffect(() => {
    load();
  }, [load]);

  const openConsultation = async (appointment: Appointment) => {
    setOpeningId(appointment.id);
    // Opening a scheduled event starts the attendance (PRD §9.3): it becomes
    // Modo Consulta on the same row, so the status reflects reality (and the
    // mobile "today" list stays honest).
    if (appointment.status === "scheduled") {
      const supabase = createClient();
      await supabase.from("consultations").update({ status: "in_progress" }).eq("id", appointment.id);
      recordAudit(supabase, "consultation.started", {
        orgId: orgId ?? undefined,
        entityType: "consultation",
        entityId: appointment.id,
      });
    }
    router.push(`/consultas/${appointment.id}`);
  };

  const cancel = async (appointment: Appointment) => {
    const supabase = createClient();
    await supabase.from("consultations").update({ status: "cancelled" }).eq("id", appointment.id);
    recordAudit(supabase, "consultation.cancelled", {
      orgId: orgId ?? undefined,
      entityType: "consultation",
      entityId: appointment.id,
    });
    await load();
  };

  const today = isSameDay(day, new Date());
  const locale = typeof navigator !== "undefined" ? navigator.language : "pt-BR";
  const dayLabel = day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  const timeRange = (appointment: Appointment) => {
    const start = new Date(appointment.startedAt);
    const end = new Date(start.getTime() + appointment.durationMinutes * 60_000);
    const fmt = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return `${fmt(start)} – ${fmt(end)}`;
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
        <Button
          variant="contained"
          color="primary"
          onClick={() => {
            setSeed(undefined);
            setDialogOpen(true);
          }}
        >
          {t("agenda-schedule")}
        </Button>
      </Grid>

      {/* Day navigator */}
      <Grid size={12}>
        <Card component="section">
          <CardContent className="flex flex-row items-center justify-between gap-2 py-3!">
            <IconButton aria-label={t("agenda-prev-day")} onClick={() => setDay(new Date(day.getTime() - DAY_MS))}>
              <NiChevronLeft size="medium" />
            </IconButton>
            <Box className="flex flex-col items-center">
              <Typography variant="h6" component="p" className="mb-0 capitalize">
                {dayLabel}
              </Typography>
              {!today && (
                <Button variant="text" color="grey" size="small" onClick={() => setDay(startOfDay(new Date()))}>
                  {t("agenda-today")}
                </Button>
              )}
              {today && (
                <Typography variant="body2" className="text-primary text-xs font-semibold">
                  {t("agenda-today")}
                </Typography>
              )}
            </Box>
            <IconButton aria-label={t("agenda-next-day")} onClick={() => setDay(new Date(day.getTime() + DAY_MS))}>
              <NiChevronRight size="medium" />
            </IconButton>
          </CardContent>
        </Card>
      </Grid>

      <Grid size={12}>
        {!appointments ? (
          <Box className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={92} className="rounded-3xl" />
            ))}
          </Box>
        ) : appointments.length === 0 ? (
          <Card component="section">
            <CardContent>
              <EmptyState
                icon={<NiCalendarClock />}
                title={t("agenda-empty-title")}
                description={today ? t("agenda-empty-today") : t("agenda-empty-day")}
                action={{
                  label: t("agenda-schedule"),
                  onClick: () => {
                    setSeed(undefined);
                    setDialogOpen(true);
                  },
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <Box className="flex flex-col gap-3">
            {appointments.map((appointment) => {
              const isScheduled = appointment.status === "scheduled";
              const isFinalized = appointment.status === "finalized";
              return (
                <Card key={appointment.id} component="section">
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
                      {appointment.reason && (
                        <Typography variant="body2" className="text-text-secondary truncate text-xs">
                          {appointment.reason}
                        </Typography>
                      )}
                    </Box>
                    <Box className="flex flex-row flex-wrap gap-2">
                      <Button
                        variant={isScheduled ? "contained" : "outlined"}
                        color={isScheduled ? "primary" : "grey"}
                        size="small"
                        disabled={openingId === appointment.id}
                        onClick={() => openConsultation(appointment)}
                      >
                        {isScheduled ? t("agenda-start") : isFinalized ? t("agenda-view") : t("agenda-open")}
                      </Button>
                      {isScheduled && (
                        <>
                          <Button
                            variant="text"
                            color="grey"
                            size="small"
                            onClick={() => {
                              setSeed({
                                consultationId: appointment.id,
                                patientId: appointment.patientId,
                                startAt: appointment.startedAt,
                                durationMinutes: appointment.durationMinutes,
                                reason: appointment.reason ?? undefined,
                              });
                              setDialogOpen(true);
                            }}
                          >
                            {t("agenda-reschedule")}
                          </Button>
                          <Button variant="text" color="grey" size="small" onClick={() => cancel(appointment)}>
                            {t("agenda-cancel-appointment")}
                          </Button>
                        </>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Box>
        )}
      </Grid>

      {orgId && (
        <ScheduleDialog
          open={dialogOpen}
          orgId={orgId}
          seed={seed}
          onClose={() => setDialogOpen(false)}
          onSaved={load}
        />
      )}
    </Grid>
  );
}
