"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Card, CardContent, Grid, Skeleton, Typography } from "@mui/material";

import { TONE } from "@/components/marketing/tone";
import AudioUsageCard from "@/components/product/audio-usage-card";
import ConsultationBriefingDialog from "@/components/product/consultation-briefing-dialog";
import EmptyState from "@/components/product/empty-state";
import OnboardingChecklistCard from "@/components/product/onboarding-checklist-card";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useProfile } from "@/hooks/use-profile";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiUsers from "@/icons/nexture/ni-users";
import { calendarDayRange, calendarOverdueRange, startAppointment } from "@/lib/agenda";
import { getProductAction, type ProductActionId } from "@/lib/product-actions";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

/** Home shortcuts: short tile labels (the command-palette copy is too long for
 * a 4-up grid), href resolved from the shared PRODUCT_ACTIONS registry. */
const QUICK_ACTIONS: { id: ProductActionId; labelKey: string; icon: React.ReactNode; tone: keyof typeof TONE }[] = [
  { id: "new-patient", labelKey: "home-quick-new-patient", icon: <NiUsers />, tone: "accent-2" },
  { id: "new-appointment", labelKey: "home-quick-new-appointment", icon: <NiCalendarClock />, tone: "primary" },
  { id: "agenda", labelKey: "home-quick-agenda", icon: <NiCalendar />, tone: "accent-1" },
  { id: "library", labelKey: "home-quick-library", icon: <NiBook />, tone: "accent-4" },
];

/** Colored status signal reused across every consultation row on Home, so the
 * two lists (in-progress vs recent) read apart without duplicating the label. */
const STATUS_DOT: Record<string, string> = {
  scheduled: "bg-accent-2",
  in_progress: "bg-primary",
  awaiting_review: "bg-accent-2",
  draft: "bg-grey-300",
  finalized: "bg-accent-1",
};

type HomeConsultation = {
  id: string;
  status: string;
  startedAt: string;
  scheduledFor: string | null;
  appointmentNote: string | null;
  patientId: string | null;
  patientName: string;
};

type HomeData = {
  patients: number;
  finalized: number;
  today: HomeConsultation[];
  work: HomeConsultation[];
  recent: HomeConsultation[];
  overdue: HomeConsultation[];
};

const WORK_PRIORITY: Record<string, number> = { in_progress: 0, awaiting_review: 1, draft: 2 };

/** How far back the "left behind" check scans for never-started appointments. */
const OVERDUE_LOOKBACK_DAYS = 60;
const NEW_PATIENT_HREF = getProductAction("new-patient").href;
const NEW_APPOINTMENT_HREF = getProductAction("new-appointment").href;

/** The Home answers, in order: what happens today, what is unfinished, and
 * what happened recently. Counts stay supporting context instead of taking
 * the prime screen real estate from the practitioner's next action. */
export default function Inicio() {
  const t = useTranslations("product");
  const locale = useLocale();
  const router = useRouter();
  const { enqueueSnackbar } = useSnackbar();
  const { displayName } = useProfile();
  const { orgId, timezone, loading: orgLoading, error: orgError, reload: reloadOrg } = useCurrentOrg();
  const [homeState, setHomeState] = useState<RemoteState<HomeData, string>>(() => remoteLoading());
  const [startingId, setStartingId] = useState<string | null>(null);
  const [briefingFor, setBriefingFor] = useState<HomeConsultation | null>(null);

  const load = useCallback(async () => {
    setHomeState(remoteLoading());
    if (!isSupabaseConfigured) {
      setHomeState(remoteSuccess({ patients: 0, finalized: 0, today: [], work: [], recent: [], overdue: [] }));
      return;
    }
    if (orgLoading) return;
    if (orgError) {
      setHomeState(remoteError(t("home-load-error")));
      return;
    }
    if (!orgId) {
      setHomeState(remoteError(t("home-no-workspace")));
      return;
    }

    const supabase = createClient();
    const { start, end } = calendarDayRange(new Date(), timezone);
    const overdueRange = calendarOverdueRange(new Date(), OVERDUE_LOOKBACK_DAYS, timezone);
    const consultationFields =
      "id, status, started_at, scheduled_for, appointment_note, patient_id, patients(full_name)";
    const results = await Promise.all([
      supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .is("archived_at", null),
      supabase
        .from("consultations")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "finalized"),
      supabase
        .from("consultations")
        .select(consultationFields)
        .eq("org_id", orgId)
        .in("status", ["scheduled", "in_progress"])
        .gte("scheduled_for", start.toISOString())
        .lt("scheduled_for", end.toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(20),
      supabase
        .from("consultations")
        .select(consultationFields)
        .eq("org_id", orgId)
        .in("status", ["in_progress", "awaiting_review", "draft"])
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("consultations")
        .select(consultationFields)
        .eq("org_id", orgId)
        .eq("status", "finalized")
        .order("finalized_at", { ascending: false })
        .limit(5),
      supabase
        .from("consultations")
        .select(consultationFields)
        .eq("org_id", orgId)
        .eq("status", "scheduled")
        .gte("scheduled_for", overdueRange.start.toISOString())
        .lt("scheduled_for", overdueRange.end.toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(10),
    ]).catch(() => null);

    if (!results) {
      setHomeState(remoteError(t("home-load-error")));
      return;
    }

    const [patientsResult, finalizedResult, todayResult, workResult, recentResult, overdueResult] = results;

    if (
      patientsResult.error ||
      finalizedResult.error ||
      todayResult.error ||
      workResult.error ||
      recentResult.error ||
      overdueResult.error
    ) {
      setHomeState(remoteError(t("home-load-error")));
      return;
    }

    const mapRows = (rows: typeof todayResult.data): HomeConsultation[] =>
      (rows ?? []).map((row) => {
        const patient = row.patients as unknown as { full_name: string } | null;
        return {
          id: row.id,
          status: row.status,
          startedAt: row.started_at,
          scheduledFor: row.scheduled_for,
          appointmentNote: row.appointment_note,
          patientId: (row.patient_id as string | null) ?? null,
          patientName: patient?.full_name ?? t("patient-unknown"),
        };
      });

    const today = mapRows(todayResult.data);
    const todayIds = new Set(today.map((row) => row.id));
    const work = mapRows(workResult.data)
      .filter((row) => !todayIds.has(row.id))
      .sort((a, b) => {
        const status = WORK_PRIORITY[a.status] - WORK_PRIORITY[b.status];
        return status || consultationDate(b).localeCompare(consultationDate(a));
      })
      .slice(0, 6);
    const recent = mapRows(recentResult.data);
    const overdue = mapRows(overdueResult.data);

    setHomeState(
      remoteSuccess({
        patients: patientsResult.count ?? 0,
        finalized: finalizedResult.count ?? 0,
        today,
        work,
        recent,
        overdue,
      }),
    );
  }, [orgError, orgId, orgLoading, t, timezone]);

  useEffect(() => {
    load();
  }, [load]);

  const startScheduled = async (consultation: HomeConsultation) => {
    if (!orgId || startingId) return;
    setStartingId(consultation.id);
    const result = await startAppointment(createClient(), orgId, consultation.id);
    setStartingId(null);
    if (result.ok && result.consultationId) {
      router.push(`/consultas/${result.consultationId}`);
      return;
    }
    if (result.code === "active_consultation_exists" && result.consultationId) {
      enqueueSnackbar(t("agenda-active-consultation-exists"), { variant: "info" });
      router.push(`/consultas/${result.consultationId}`);
      return;
    }
    enqueueSnackbar(t("agenda-start-error"), { variant: "error" });
    await load();
  };

  const greeting = displayName ? t("home-greeting", { name: displayName.split(" ")[0] }) : t("home-greeting-generic");
  const data = homeState.status === "success" ? homeState.data : null;

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h1" component="h1" className="mb-0">
              {greeting}
            </Typography>
            <Breadcrumbs>
              <Typography variant="body2">{t("home-breadcrumb")}</Typography>
            </Breadcrumbs>
          </Box>
          {data && (
            <Button
              variant="contained"
              href={data.patients === 0 ? NEW_PATIENT_HREF : NEW_APPOINTMENT_HREF}
              LinkComponent={Link}
              startIcon={data.patients === 0 ? <NiUsers /> : <NiCalendar />}
            >
              {data.patients === 0 ? t("home-empty-cta") : t("home-schedule-cta")}
            </Button>
          )}
        </Box>
      </Grid>

      <Grid size={12}>
        <Box className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_ACTIONS.map((action) => {
            const definition = getProductAction(action.id);
            const toneStyle = TONE[action.tone];
            return (
              <Card
                key={action.id}
                component={Link}
                href={definition.href}
                className="hover:shadow-darker-sm transition-shadow"
              >
                <CardContent className="flex flex-col items-center gap-2 py-4! text-center">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-2xl [&_svg]:h-5 [&_svg]:w-5",
                      toneStyle.softBg,
                      toneStyle.text,
                    )}
                  >
                    {action.icon}
                  </span>
                  <Typography variant="body2" className="text-text-primary font-medium">
                    {t(action.labelKey)}
                  </Typography>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      </Grid>

      {homeState.status === "error" && (
        <Grid size={12}>
          <Alert severity="error" action={<Button onClick={orgError ? reloadOrg : load}>{t("retry")}</Button>}>
            {homeState.error}
          </Alert>
        </Grid>
      )}

      {homeState.status === "error" ? null : homeState.status === "idle" || homeState.status === "loading" ? (
        <Grid size={12}>
          <Skeleton variant="rounded" height={300} className="rounded-3xl" />
        </Grid>
      ) : homeState.status === "empty" ? null : data!.patients === 0 ? (
        <Grid size={12} className="empty:hidden">
          <OnboardingChecklistCard
            fallback={
              <Card component="section">
                <CardContent>
                  <EmptyState
                    icon={<NiUsers />}
                    title={t("home-empty-title")}
                    description={t("home-empty-body")}
                    action={{ label: t("home-empty-cta"), href: NEW_PATIENT_HREF }}
                  />
                </CardContent>
              </Card>
            }
          />
        </Grid>
      ) : (
        <>
          {data!.overdue.length > 0 && (
            <Grid size={12}>
              <Alert
                severity="warning"
                icon={<NiCalendar />}
                className="neutral bg-background-paper/60!"
                component="section"
                aria-label={t("home-overdue-title", { count: data!.overdue.length })}
              >
                <Box className="flex flex-col gap-2">
                  <Box>
                    <Typography variant="body2" className="font-semibold">
                      {t("home-overdue-title", { count: data!.overdue.length })}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary text-xs">
                      {t("home-overdue-body")}
                    </Typography>
                  </Box>
                  {data!.overdue.map((consultation) => {
                    const instant = new Date(consultation.scheduledFor ?? consultation.startedAt);
                    const dia = new Intl.DateTimeFormat("en-CA", {
                      timeZone: timezone,
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(instant);
                    return (
                      <Box key={consultation.id} className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
                        <Typography variant="body2" className="tabular-nums">
                          {`${instant.toLocaleDateString(locale, {
                            weekday: "short",
                            day: "2-digit",
                            month: "2-digit",
                            timeZone: timezone,
                          })} · ${instant.toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: timezone,
                          })}`}
                        </Typography>
                        <Typography variant="body2" className="font-medium">
                          {consultation.patientName}
                        </Typography>
                        <Button
                          variant="text"
                          color="grey"
                          size="small"
                          href={`/agenda?dia=${dia}`}
                          LinkComponent={Link}
                          aria-label={t("home-overdue-resolve-for", { patient: consultation.patientName })}
                        >
                          {t("home-overdue-resolve")}
                        </Button>
                      </Box>
                    );
                  })}
                </Box>
              </Alert>
            </Grid>
          )}
          <Grid size={12}>
            <Card component="section">
              <CardContent className="flex flex-col gap-3">
                <Box className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <Box>
                    <Typography variant="h5" component="h2" className="card-title">
                      {t("home-today-title")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t("home-today-subtitle")}
                    </Typography>
                  </Box>
                  <Button size="small" href="/agenda" LinkComponent={Link}>
                    {t("home-open-agenda")}
                  </Button>
                </Box>
                {data!.today.length === 0 ? (
                  <EmptyState
                    icon={<NiCalendar />}
                    title={t("home-today-empty-title")}
                    description={t("home-today-empty-body")}
                    action={{ label: t("home-schedule-cta"), href: NEW_APPOINTMENT_HREF }}
                    className="border-none py-8"
                  />
                ) : (
                  <Box className="grid gap-2 lg:grid-cols-2">
                    {data!.today.map((consultation) => (
                      <ConsultationRow
                        key={consultation.id}
                        consultation={consultation}
                        locale={locale}
                        timeZone={timezone}
                        label={consultation.status === "scheduled" ? t("agenda-start") : t("home-open-draft")}
                        busy={startingId === consultation.id}
                        onAction={consultation.status === "scheduled" ? () => startScheduled(consultation) : undefined}
                        secondary={
                          consultation.patientId
                            ? { label: t("briefing-prepare"), onClick: () => setBriefingFor(consultation) }
                            : undefined
                        }
                      />
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={12} className="empty:hidden">
            <OnboardingChecklistCard />
          </Grid>

          {data!.work.length > 0 && (
            <Grid size={{ xs: 12, lg: data!.recent.length > 0 ? 7 : 12 }}>
              <Card component="section" className="h-full">
                <CardContent className="flex flex-col gap-3">
                  <Typography variant="h5" component="h2" className="card-title">
                    {t("home-work-title")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary -mt-2">
                    {t("home-work-subtitle")}
                  </Typography>
                  <Box className="flex flex-col gap-1">
                    {data!.work.map((consultation) => (
                      <ConsultationRow
                        key={consultation.id}
                        consultation={consultation}
                        locale={locale}
                        timeZone={timezone}
                        label={
                          consultation.status === "awaiting_review" ? t("home-review-draft") : t("home-open-draft")
                        }
                      />
                    ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}

          {data!.recent.length > 0 && (
            <Grid size={{ xs: 12, lg: data!.work.length > 0 ? 5 : 12 }}>
              <Card component="section" className="h-full">
                <CardContent className="flex flex-col gap-3">
                  <Typography variant="h5" component="h2" className="card-title">
                    {t("home-recent-title")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary -mt-2">
                    {t("home-recent-subtitle")}
                  </Typography>
                  <Box className="flex flex-col gap-1">
                    {data!.recent.map((consultation) => (
                      <ConsultationRow
                        key={consultation.id}
                        consultation={consultation}
                        locale={locale}
                        timeZone={timezone}
                        label={t("home-open-record")}
                      />
                    ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}

          <Grid size={12}>
            <Box className="grid gap-4 sm:grid-cols-2">
              <Metric
                icon={<NiUsers />}
                tone="accent-2"
                value={data!.patients}
                label={t("home-metric-patients")}
                href="/pacientes"
              />
              <Metric
                icon={<NiCheckSquare />}
                tone="accent-1"
                value={data!.finalized}
                label={t("home-metric-finalized")}
                href="/pacientes"
              />
            </Box>
          </Grid>
        </>
      )}

      {homeState.status === "success" && data!.patients > 0 && (
        <Grid size={12}>
          <AudioUsageCard />
        </Grid>
      )}

      {briefingFor?.patientId && (
        <ConsultationBriefingDialog
          open
          onClose={() => setBriefingFor(null)}
          patientId={briefingFor.patientId}
          patientName={briefingFor.patientName}
          appointmentNote={briefingFor.appointmentNote}
        />
      )}
    </Grid>
  );
}

const consultationDate = (consultation: HomeConsultation) => consultation.scheduledFor ?? consultation.startedAt;

function Metric({
  icon,
  tone,
  value,
  label,
  href,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE;
  value: number;
  label: string;
  href: string;
}) {
  const toneStyle = TONE[tone];
  return (
    <Card component={Link} href={href} className="hover:shadow-darker-sm transition-shadow">
      <CardContent className="flex flex-row items-center gap-4">
        <span
          className={cn(
            "flex h-12 w-12 flex-none items-center justify-center rounded-2xl [&_svg]:h-6 [&_svg]:w-6",
            toneStyle.softBg,
            toneStyle.text,
          )}
        >
          {icon}
        </span>
        <Box>
          <Typography variant="h3" component="p" className="text-text-primary leading-none">
            {value}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {label}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

function ConsultationRow({
  consultation,
  label,
  locale,
  timeZone,
  busy = false,
  onAction,
  secondary,
}: {
  consultation: HomeConsultation;
  label: string;
  locale: string;
  timeZone: string;
  busy?: boolean;
  onAction?: () => void;
  /** Optional second affordance (e.g. the pre-consultation briefing). */
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <Box className="hover:bg-grey-25 flex flex-col items-stretch gap-3 rounded-2xl px-3 py-3 transition-colors sm:flex-row sm:items-center sm:py-2.5">
      <Box className="min-w-0 flex-1">
        <Typography
          variant="body1"
          className="text-text-primary flex items-center gap-2 font-medium break-words sm:truncate"
        >
          <span
            aria-hidden
            className={cn("h-2 w-2 flex-none rounded-full", STATUS_DOT[consultation.status] ?? "bg-grey-300")}
          />
          {consultation.patientName}
        </Typography>
        <Typography variant="body2" className="text-text-secondary break-words sm:truncate">
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "short",
            timeStyle: consultation.scheduledFor ? "short" : undefined,
            timeZone,
          }).format(new Date(consultationDate(consultation)))}
          {consultation.appointmentNote ? ` · ${consultation.appointmentNote}` : ""}
        </Typography>
      </Box>
      <Box className="flex w-full flex-col gap-2 min-[420px]:flex-row sm:w-auto">
        {secondary && (
          <Button size="small" variant="text" color="grey" onClick={secondary.onClick} className="flex-1 sm:flex-none">
            {secondary.label}
          </Button>
        )}
        {onAction ? (
          <Button
            size="small"
            variant="text"
            color="primary"
            onClick={onAction}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            {label}
          </Button>
        ) : (
          <Button
            size="small"
            variant="text"
            color="primary"
            href={`/consultas/${consultation.id}`}
            LinkComponent={Link}
            className="flex-1 sm:flex-none"
          >
            {label}
          </Button>
        )}
      </Box>
    </Box>
  );
}
