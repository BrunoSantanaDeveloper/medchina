"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useState } from "react";

import Timeline from "@mui/lab/Timeline";
import TimelineConnector from "@mui/lab/TimelineConnector";
import TimelineContent from "@mui/lab/TimelineContent";
import TimelineDot from "@mui/lab/TimelineDot";
import TimelineItem from "@mui/lab/TimelineItem";
import TimelineSeparator from "@mui/lab/TimelineSeparator";
import { Alert, Box, Breadcrumbs, Button, Card, CardContent, Grid, Skeleton, Typography } from "@mui/material";

import AssistantBand from "@/components/product/assistant-band";
import AudioUsageCard from "@/components/product/audio-usage-card";
import ConsultationBriefingDialog from "@/components/product/consultation-briefing-dialog";
import ConsultationStatusChip from "@/components/product/consultation-status-chip";
import ConversionOfferCard from "@/components/product/conversion-offer-card";
import HomeEmptyBanner from "@/components/product/home-empty-banner";
import { QuickActionTile, StatTile } from "@/components/product/home-tiles";
import OnboardingChecklistCard from "@/components/product/onboarding-checklist-card";
import type { TileTone } from "@/components/product/tile-tone";
import WeekSchedule, { dayKey, type ScheduleItem } from "@/components/product/week-schedule";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useProfile } from "@/hooks/use-profile";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiUsers from "@/icons/nexture/ni-users";
import { calendarOverdueRange, calendarUpcomingRange, startAppointment } from "@/lib/agenda";
import { getProductAction, type ProductActionId } from "@/lib/product-actions";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

/** Home shortcuts: short tile label + one-line hint (the command-palette copy
 * is written for a wide list and gets clamped in a 4-up grid); the href comes
 * from the shared PRODUCT_ACTIONS registry so the two never disagree. */
const QUICK_ACTIONS: {
  id: ProductActionId;
  labelKey: string;
  hintKey: string;
  icon: React.ReactNode;
  tone: TileTone;
}[] = [
  {
    id: "new-patient",
    labelKey: "home-quick-new-patient",
    hintKey: "home-quick-new-patient-hint",
    icon: <NiUsers size="large" />,
    tone: "accent-2",
  },
  {
    id: "new-appointment",
    labelKey: "home-quick-new-appointment",
    hintKey: "home-quick-new-appointment-hint",
    icon: <NiCalendarClock size="large" />,
    tone: "primary",
  },
  {
    id: "agenda",
    labelKey: "home-quick-agenda",
    hintKey: "home-quick-agenda-hint",
    icon: <NiCalendar size="large" />,
    tone: "accent-1",
  },
  {
    id: "library",
    labelKey: "home-quick-library",
    hintKey: "home-quick-library-hint",
    icon: <NiBook size="large" />,
    tone: "accent-4",
  },
];

type HomeConsultation = {
  id: string;
  status: string;
  startedAt: string;
  scheduledFor: string | null;
  finalizedAt: string | null;
  appointmentNote: string | null;
  patientId: string | null;
  patientName: string;
};

type HomeData = {
  patients: number;
  finalized: number;
  /** Scheduled and live visits from today's midnight through the next six days. */
  week: HomeConsultation[];
  work: HomeConsultation[];
  recent: HomeConsultation[];
  overdue: HomeConsultation[];
};

type BriefingTarget = { patientId: string; patientName: string; appointmentNote: string | null };

const EMPTY_DATA: HomeData = { patients: 0, finalized: 0, week: [], work: [], recent: [], overdue: [] };
const WORK_PRIORITY: Record<string, number> = { in_progress: 0, awaiting_review: 1, draft: 2 };

/** The schedule card offers a strip of this many days, today first. */
const WEEK_DAYS = 7;
/** How far back the "left behind" check scans for never-started appointments. */
const OVERDUE_LOOKBACK_DAYS = 60;
const NEW_PATIENT_HREF = getProductAction("new-patient").href;
const NEW_APPOINTMENT_HREF = getProductAction("new-appointment").href;
const AGENDA_HREF = getProductAction("agenda").href;
const PATIENTS_HREF = getProductAction("patients").href;

const consultationDate = (consultation: HomeConsultation) => consultation.scheduledFor ?? consultation.startedAt;

/** The Home answers, in order: what happens this week (today selected), what
 * is unfinished, and what was finalized recently. Counts stay supporting
 * context at the bottom instead of taking the prime screen real estate from
 * the practitioner's next action. */
export default function Inicio() {
  const t = useTranslations("product");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const { enqueueSnackbar } = useSnackbar();
  const { displayName } = useProfile();
  const { orgId, timezone, loading: orgLoading, error: orgError, reload: reloadOrg } = useCurrentOrg();
  const [homeState, setHomeState] = useState<RemoteState<HomeData, string>>(() => remoteLoading());
  const [startingId, setStartingId] = useState<string | null>(null);
  const [briefingFor, setBriefingFor] = useState<BriefingTarget | null>(null);

  const load = useCallback(async () => {
    setHomeState(remoteLoading());
    if (!isSupabaseConfigured) {
      setHomeState(remoteSuccess(EMPTY_DATA));
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
    const week = calendarUpcomingRange(new Date(), WEEK_DAYS, timezone);
    const overdueRange = calendarOverdueRange(new Date(), OVERDUE_LOOKBACK_DAYS, timezone);
    const consultationFields =
      "id, status, started_at, scheduled_for, finalized_at, appointment_note, patient_id, patients(full_name)";
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
        .gte("scheduled_for", week.start.toISOString())
        .lt("scheduled_for", week.end.toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(60),
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

    const [patientsResult, finalizedResult, weekResult, workResult, recentResult, overdueResult] = results;

    if (
      patientsResult.error ||
      finalizedResult.error ||
      weekResult.error ||
      workResult.error ||
      recentResult.error ||
      overdueResult.error
    ) {
      setHomeState(remoteError(t("home-load-error")));
      return;
    }

    const mapRows = (rows: typeof weekResult.data): HomeConsultation[] =>
      (rows ?? []).map((row) => {
        const patient = row.patients as unknown as { full_name: string } | null;
        return {
          id: row.id,
          status: row.status,
          startedAt: row.started_at,
          scheduledFor: row.scheduled_for,
          finalizedAt: row.finalized_at,
          appointmentNote: row.appointment_note,
          patientId: (row.patient_id as string | null) ?? null,
          patientName: patient?.full_name ?? t("patient-unknown"),
        };
      });

    const weekRows = mapRows(weekResult.data);
    const weekIds = new Set(weekRows.map((row) => row.id));
    const work = mapRows(workResult.data)
      .filter((row) => !weekIds.has(row.id))
      .sort((a, b) => {
        const status = WORK_PRIORITY[a.status] - WORK_PRIORITY[b.status];
        return status || consultationDate(b).localeCompare(consultationDate(a));
      })
      .slice(0, 6);

    setHomeState(
      remoteSuccess({
        patients: patientsResult.count ?? 0,
        finalized: finalizedResult.count ?? 0,
        week: weekRows,
        work,
        recent: mapRows(recentResult.data),
        overdue: mapRows(overdueResult.data),
      }),
    );
  }, [orgError, orgId, orgLoading, t, timezone]);

  useEffect(() => {
    load();
  }, [load]);

  const openConsultation = async (item: Pick<ScheduleItem, "id" | "status">) => {
    if (item.status !== "scheduled") {
      router.push(`/consultas/${item.id}`);
      return;
    }
    if (!orgId || startingId) return;
    setStartingId(item.id);
    const result = await startAppointment(createClient(), orgId, item.id);
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

  // Today is a slice of the week window, so the band, the stats and the
  // schedule card all agree on who is next without a second query.
  const now = new Date();
  const todayKey = dayKey(now, timezone);
  const today = (data?.week ?? []).filter(
    (consultation) => dayKey(new Date(consultationDate(consultation)), timezone) === todayKey,
  );
  const nextToRecord = today.find((consultation) => consultation.status === "scheduled") ?? null;
  const briefingCandidate = today.find((consultation) => consultation.patientId) ?? null;
  const scheduleItems: ScheduleItem[] = (data?.week ?? []).map((consultation) => ({
    id: consultation.id,
    status: consultation.status,
    at: consultationDate(consultation),
    patientId: consultation.patientId,
    patientName: consultation.patientName,
    note: consultation.appointmentNote,
  }));
  // The briefing is assembled from the record, so it needs a patient.
  const briefingFrom = (item: { patientId: string | null; patientName: string; note: string | null }) => {
    if (item.patientId) {
      setBriefingFor({ patientId: item.patientId, patientName: item.patientName, appointmentNote: item.note });
    }
  };

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

      <Grid container size={12} spacing={2.5}>
        {QUICK_ACTIONS.map((action) => {
          const definition = getProductAction(action.id);
          return (
            <Grid key={action.id} size={{ xs: 12, sm: 6, lg: 3 }}>
              <QuickActionTile
                href={definition.href}
                icon={action.icon}
                tone={action.tone}
                title={t(action.labelKey)}
                description={t(action.hintKey)}
              />
            </Grid>
          );
        })}
      </Grid>

      {homeState.status === "error" && (
        <Grid size={12}>
          <Alert severity="error" action={<Button onClick={orgError ? reloadOrg : load}>{t("retry")}</Button>}>
            {homeState.error}
          </Alert>
        </Grid>
      )}

      {/* Above the work, and only while a live offer exists (migration 0088):
          it is time-boxed, so burying it under the day's list would waste the
          window she was given. Renders nothing the rest of the time. */}
      <Grid size={12} className="empty:hidden">
        <ConversionOfferCard orgId={orgId} />
      </Grid>

      {homeState.status === "error" ? null : homeState.status === "idle" || homeState.status === "loading" ? (
        <Grid size={12}>
          <Skeleton variant="rounded" height={300} className="rounded-3xl" />
        </Grid>
      ) : homeState.status === "empty" ? null : data!.patients === 0 ? (
        <>
          {/* The illustrated card is the zero-data state of the whole home:
              nothing else here has anything to show before the first patient. */}
          <Grid size={12}>
            <HomeEmptyBanner />
          </Grid>
          <Grid size={12} className="empty:hidden">
            <OnboardingChecklistCard />
          </Grid>
        </>
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
                    <Typography variant="subtitle2">
                      {t("home-overdue-title", { count: data!.overdue.length })}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t("home-overdue-body")}
                    </Typography>
                  </Box>
                  {data!.overdue.map((consultation) => {
                    const instant = new Date(consultation.scheduledFor ?? consultation.startedAt);
                    const dia = dayKey(instant, timezone);
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

          {/* What this product does differently, above the day's work but
              deliberately compact — the scannable answer stays in reach.
              See docs/HOME-ASSISTENTE.md for why this is a band, not a chat. */}
          <Grid size={12}>
            <AssistantBand
              hasPatients={data!.patients > 0}
              recordHref={nextToRecord ? `/consultas/${nextToRecord.id}` : undefined}
              onPrepareBriefing={
                briefingCandidate
                  ? () =>
                      briefingFrom({
                        patientId: briefingCandidate.patientId,
                        patientName: briefingCandidate.patientName,
                        note: briefingCandidate.appointmentNote,
                      })
                  : undefined
              }
            />
          </Grid>

          <Grid size={12} className="empty:hidden">
            <OnboardingChecklistCard />
          </Grid>

          {/* Template layout: the week and the pending work take the wide
              column; the activity timeline reads down the narrow one. */}
          <Grid container size={{ xs: 12, lg: data!.recent.length > 0 ? 8 : 12 }} spacing={5}>
            <Grid size={12}>
              <WeekSchedule
                items={scheduleItems}
                timeZone={timezone}
                locale={locale}
                agendaHref={AGENDA_HREF}
                scheduleHref={NEW_APPOINTMENT_HREF}
                startingId={startingId}
                onStart={openConsultation}
                onBriefing={briefingFrom}
              />
            </Grid>

            {data!.work.length > 0 && (
              <Grid size={12}>
                <Card component="section" className="h-full">
                  <Typography variant="h5" component="h2" className="card-title px-4 pt-4">
                    {t("home-work-title")}
                  </Typography>
                  <CardContent className="pt-0!">
                    <Box className="flex flex-col gap-4">
                      {data!.work.map((consultation) => (
                        <PendingRow
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
          </Grid>

          {data!.recent.length > 0 && (
            <Grid size={{ xs: 12, lg: 4 }}>
              <Card component="section" className="h-full">
                <Typography variant="h5" component="h2" className="card-title px-4 pt-4">
                  {t("home-recent-title")}
                </Typography>
                <CardContent className="pt-0! pr-0!">
                  {/* The template's activity timeline: "what happened recently"
                      is a sequence, and the connector says so at a glance. */}
                  <Timeline className="items-start">
                    {data!.recent.map((consultation, index) => (
                      <TimelineItem key={consultation.id}>
                        <TimelineSeparator>
                          <TimelineDot variant="outlined" className="border-accent-1!" />
                          {index < data!.recent.length - 1 && <TimelineConnector />}
                        </TimelineSeparator>
                        <TimelineContent>
                          <Typography variant="subtitle2" className="text-text-primary break-words">
                            {consultation.patientName}
                          </Typography>
                          <Typography variant="body2" className="text-text-secondary line-clamp-1">
                            <Link href={`/consultas/${consultation.id}`} className="link-text-secondary">
                              {t("home-open-record")}
                            </Link>
                          </Typography>
                          {/* Secondary, not disabled: "há 3 dias" is information, and
                              the disabled tone measures 1.6:1 on the card. */}
                          <Typography variant="body2" className="text-text-secondary">
                            {format.relativeTime(
                              new Date(consultation.finalizedAt ?? consultationDate(consultation)),
                              now,
                            )}
                          </Typography>
                        </TimelineContent>
                      </TimelineItem>
                    ))}
                  </Timeline>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Four real counts, every one of them already loaded above — no
              extra query, and nothing invented: the PRD forbids unproven
              metrics, so there is no trend arrow and no percentage here. */}
          <Grid container size={12} spacing={2.5}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile
                href={AGENDA_HREF}
                icon={<NiCalendar size="large" />}
                tone="primary"
                label={t("home-metric-today")}
                value={today.length}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile
                href={PATIENTS_HREF}
                icon={<NiListCheck size="large" />}
                tone="accent-3"
                label={t("home-metric-pending")}
                value={data!.work.length}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile
                href={PATIENTS_HREF}
                icon={<NiUsers size="large" />}
                tone="accent-2"
                label={t("home-metric-patients")}
                value={data!.patients}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatTile
                href={PATIENTS_HREF}
                icon={<NiCheckSquare size="large" />}
                tone="accent-1"
                label={t("home-metric-finalized")}
                value={data!.finalized}
              />
            </Grid>
          </Grid>
        </>
      )}

      {homeState.status === "success" && data!.patients > 0 && (
        <Grid size={12}>
          <AudioUsageCard />
        </Grid>
      )}

      {briefingFor && (
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

/** One unfinished record, in the template's schedule-row idiom: a stage icon,
 * the patient with a named status badge, the when/what line, and the single
 * action that moves it forward. */
function PendingRow({
  consultation,
  label,
  locale,
  timeZone,
}: {
  consultation: HomeConsultation;
  label: string;
  locale: string;
  timeZone: string;
}) {
  const icon =
    consultation.status === "in_progress" ? (
      <NiMicrophone className="text-primary mt-0.5 flex-none" />
    ) : consultation.status === "awaiting_review" ? (
      <NiListCheck className="text-accent-3 mt-0.5 flex-none" />
    ) : (
      <NiCheckSquare className="text-text-secondary mt-0.5 flex-none" />
    );
  return (
    <Box className="flex flex-row gap-2.5">
      {icon}
      <Box className="min-w-0 flex-1">
        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Typography variant="subtitle2" className="break-words">
            {consultation.patientName}
          </Typography>
          <ConsultationStatusChip status={consultation.status} />
        </Box>
        <Typography variant="body2" className="text-text-secondary line-clamp-1">
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "short",
            timeStyle: consultation.scheduledFor ? "short" : undefined,
            timeZone,
          }).format(new Date(consultationDate(consultation)))}
          {consultation.appointmentNote ? ` · ${consultation.appointmentNote}` : ""}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="text"
        color="primary"
        href={`/consultas/${consultation.id}`}
        LinkComponent={Link}
        className="flex-none self-center"
      >
        {label}
      </Button>
    </Box>
  );
}
