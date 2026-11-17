"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import Timeline from "@mui/lab/Timeline";
import TimelineConnector from "@mui/lab/TimelineConnector";
import TimelineContent from "@mui/lab/TimelineContent";
import TimelineDot from "@mui/lab/TimelineDot";
import TimelineItem from "@mui/lab/TimelineItem";
import TimelineOppositeContent from "@mui/lab/TimelineOppositeContent";
import TimelineSeparator from "@mui/lab/TimelineSeparator";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PatientEditDialog from "@/components/product/patient-edit-dialog";
import ScheduleDialog from "@/components/product/schedule-dialog";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import NiArchive from "@/icons/nexture/ni-archive";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiBadgeCheck from "@/icons/nexture/ni-badge-check";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPen from "@/icons/nexture/ni-pen";
import NiPulse from "@/icons/nexture/ni-pulse";
import NiSlashHexagon from "@/icons/nexture/ni-slash-hexagon";
import NiSwap from "@/icons/nexture/ni-swap";
import { defaultAppointmentStart, startAppointment } from "@/lib/agenda";
import { recordAudit } from "@/lib/audit";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { formatCpf, formatPhoneBr } from "@flyee/fields";

type Patient = {
  id: string;
  orgId: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
  document: string | null;
  email: string | null;
  notes: string | null;
  alerts: { label: string }[];
  archivedAt: string | null;
  deletionRequestedAt: string | null;
  deletionRequestReason: string | null;
  /** Cycle/fertility follow-up (0103) — opens that block in her consultations. */
  fertilityCare: boolean;
  /**
   * Set when the record came from another system (0076). A chart we cannot
   * vouch for must never look like one she typed and checked, so the origin
   * is stated on the record itself — not only in the import history.
   */
  importedFrom: { source: string | null; at: string } | null;
};

type Visit = {
  id: string;
  status: string;
  startedAt: string;
  scheduledFor: string | null;
  durationMinutes: number | null;
  chiefComplaint: string | null;
  appointmentNote: string | null;
  summary: string | null;
  /** Set when the visit came from another system: shown as such, never as an
   *  empty consultation nobody documented. */
  legacyBody: string | null;
  legacySource: string | null;
};

type PatientArtifact =
  | {
      kind: "transcription";
      id: string;
      consultationId: string;
      occurredAt: string;
    }
  | {
      kind: "document";
      id: string;
      consultationId: string | null;
      occurredAt: string;
      title: string;
      version: number;
      verifyCode: string;
      status: string;
    };

type PatientTimelineItem =
  | { kind: "visit"; occurredAt: string; visit: Visit }
  | { kind: "artifact"; occurredAt: string; artifact: PatientArtifact };

type Confirmation = "archive" | "deletion" | null;
const ACTIVE_STATUSES = ["in_progress", "awaiting_review", "draft"];

/** One tone per kind of event, reusing the correspondence the rest of the app
 *  already fixed (agenda and início): teal for what is happening now or was
 *  produced here, jade for what is closed, slate-blue for what is scheduled or
 *  waiting on her, camel for material that came from another system, grey for a
 *  draft and for what never happened. Red stays reserved for risk — a cancelled
 *  visit is not a failure. */
const EVENT_TONE = {
  active: "bg-primary-light/10 text-primary",
  done: "bg-accent-1-light/10 text-accent-1",
  pending: "bg-accent-2-light/10 text-accent-2",
  imported: "bg-secondary-light/10 text-secondary-dark dark:text-secondary",
  inert: "bg-grey-100 text-text-secondary",
};

type EventVisual = { tone: string; icon: ReactNode };

const STATUS_VISUAL: Record<string, EventVisual> = {
  scheduled: { tone: EVENT_TONE.pending, icon: <NiCalendarClock /> },
  in_progress: { tone: EVENT_TONE.active, icon: <NiPulse /> },
  awaiting_review: { tone: EVENT_TONE.pending, icon: <NiEyeOpen /> },
  draft: { tone: EVENT_TONE.inert, icon: <NiPen /> },
  finalized: { tone: EVENT_TONE.done, icon: <NiCheckSquare /> },
  cancelled: { tone: EVENT_TONE.inert, icon: <NiSlashHexagon /> },
};

/** The marker states what the event IS — never what it means clinically. */
function eventVisual(item: PatientTimelineItem): EventVisual {
  if (item.kind === "artifact") {
    if (item.artifact.kind === "transcription") return { tone: EVENT_TONE.active, icon: <NiMicrophone /> };
    // Issued documents are revoked, never deleted: a replaced document is a
    // swap, not a loss, and must not read as a destructive event.
    return item.artifact.status === "revoked"
      ? { tone: EVENT_TONE.inert, icon: <NiSwap /> }
      : { tone: EVENT_TONE.active, icon: <NiBadgeCheck /> };
  }
  // Where a record came from outranks its status: she has to know she is
  // looking at material this app did not capture before she reads it.
  if (item.visit.legacyBody) return { tone: EVENT_TONE.imported, icon: <NiArrowHistory /> };
  return STATUS_VISUAL[item.visit.status] ?? { tone: EVENT_TONE.inert, icon: <NiClipboard /> };
}

/** A patient record is a continuity surface: resume unfinished work first,
 * then offer the next useful action without making the practitioner hunt
 * through Agenda or Patients. Administrative actions stay secondary. */
export default function PacienteFicha() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const { orgId, timezone } = useCurrentOrg();
  const { allowance: audioAllowance } = useAudioAllowance(orgId);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [artifacts, setArtifacts] = useState<PatientArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [deletionReason, setDeletionReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isSupabaseConfigured) {
      setError(t("not-configured"));
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const [patientResult, consultationsResult, recordingsResult, documentsResult] = await Promise.all([
      supabase.from("patients").select("*").eq("id", params.id).maybeSingle(),
      supabase
        .from("consultations")
        .select(
          "id, status, started_at, scheduled_for, duration_minutes, chief_complaint, appointment_note, summary, legacy_body, legacy_source",
        )
        .eq("patient_id", params.id),
      supabase
        .from("recordings")
        .select("id, consultation_id, transcription_id, created_at, status")
        .eq("patient_id", params.id)
        .eq("status", "ready")
        .not("transcription_id", "is", null),
      supabase
        .from("documents")
        .select("id, consultation_id, title, version, verify_code, status, issued_at, created_at")
        .eq("patient_id", params.id)
        .in("status", ["issued", "revoked"]),
    ]);

    if (patientResult.error || consultationsResult.error || recordingsResult.error || documentsResult.error) {
      setError(t("patient-load-error"));
      setLoading(false);
      return;
    }
    if (!patientResult.data) {
      setError(t("patient-not-found"));
      setLoading(false);
      return;
    }

    const row = patientResult.data;
    let importedFrom: Patient["importedFrom"] = null;
    if (row.import_batch_id) {
      const { data: batch } = await supabase
        .from("import_batches")
        .select("source_system, completed_at")
        .eq("id", row.import_batch_id)
        .maybeSingle();
      importedFrom = {
        source: (batch?.source_system as string | null) ?? null,
        at: (batch?.completed_at as string | null) ?? row.created_at,
      };
    }

    setPatient({
      id: row.id,
      orgId: row.org_id,
      fullName: row.full_name,
      birthDate: row.birth_date,
      phone: row.phone,
      document: row.document,
      email: row.email,
      notes: row.notes,
      alerts: (row.alerts as { label: string }[] | null) ?? [],
      archivedAt: row.archived_at,
      deletionRequestedAt: row.deletion_requested_at,
      deletionRequestReason: row.deletion_request_reason,
      fertilityCare: row.fertility_care === true,
      importedFrom,
    });
    setVisits(
      (consultationsResult.data ?? [])
        .map((consultation) => ({
          id: consultation.id,
          status: consultation.status,
          startedAt: consultation.started_at,
          scheduledFor: consultation.scheduled_for,
          durationMinutes: consultation.duration_minutes,
          chiefComplaint: consultation.chief_complaint,
          legacyBody: (consultation.legacy_body as string | null) ?? null,
          legacySource: (consultation.legacy_source as string | null) ?? null,
          appointmentNote: consultation.appointment_note,
          summary: consultation.summary,
        }))
        .sort((a, b) => visitDate(b).localeCompare(visitDate(a))),
    );
    setArtifacts(
      [
        ...(recordingsResult.data ?? []).flatMap((recording) =>
          recording.transcription_id
            ? [
                {
                  kind: "transcription" as const,
                  id: recording.transcription_id,
                  consultationId: recording.consultation_id,
                  occurredAt: recording.created_at,
                },
              ]
            : [],
        ),
        ...(documentsResult.data ?? []).map((document) => ({
          kind: "document" as const,
          id: document.id,
          consultationId: document.consultation_id,
          occurredAt: document.issued_at ?? document.created_at,
          title: document.title,
          version: document.version,
          verifyCode: document.verify_code,
          status: document.status,
        })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    );
    setLoading(false);
  }, [params.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const activeVisit = useMemo(
    () => ACTIVE_STATUSES.map((status) => visits.find((visit) => visit.status === status)).find(Boolean),
    [visits],
  );
  const nextScheduled = useMemo(
    () =>
      visits
        .filter((visit) => visit.status === "scheduled" && visit.scheduledFor)
        .sort((a, b) => visitDate(a).localeCompare(visitDate(b)))[0],
    [visits],
  );
  const hasOpenWork = useMemo(
    () => visits.some((visit) => visit.status === "scheduled" || ACTIVE_STATUSES.includes(visit.status)),
    [visits],
  );
  const timelineItems = useMemo<PatientTimelineItem[]>(
    () =>
      [
        ...visits.map((visit) => ({ kind: "visit" as const, occurredAt: visitDate(visit), visit })),
        ...artifacts.map((artifact) => ({ kind: "artifact" as const, occurredAt: artifact.occurredAt, artifact })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [artifacts, visits],
  );

  /** Clinical dates follow the app locale and the CLINIC timezone, as in
   *  /consultas and /início — a consultation must not drift a day because she
   *  opened the record from somewhere else. */
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: timezone }),
    [locale, timezone],
  );
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: timezone }),
    [locale, timezone],
  );

  const recoverActiveConsultation = async () => {
    if (!patient) return false;
    const { data } = await createClient()
      .from("consultations")
      .select("id")
      .eq("patient_id", patient.id)
      .in("status", ACTIVE_STATUSES)
      .limit(1)
      .maybeSingle();
    if (!data?.id) return false;
    router.push(`/consultas/${data.id}`);
    return true;
  };

  const createConsultation = async () => {
    if (!patient || busy || patient.archivedAt) return;
    setBusy(true);
    setError(null);
    if (await recoverActiveConsultation()) return;

    const supabase = createClient();
    const { data, error: startError } = await supabase.rpc("start_manual_consultation", {
      target_patient: patient.id,
    });
    const result = data as { ok?: boolean; consultationId?: string } | null;
    if (startError || !result?.ok || !result.consultationId) {
      if (await recoverActiveConsultation()) return;
      setError(t("patient-start-error"));
      setBusy(false);
      return;
    }
    router.push(`/consultas/${result.consultationId}`);
  };

  const runPrimaryAction = async () => {
    if (activeVisit) {
      router.push(`/consultas/${activeVisit.id}`);
      return;
    }
    if (nextScheduled) {
      await startScheduledVisit(nextScheduled);
      return;
    }
    await createConsultation();
  };

  const startScheduledVisit = async (visit: Visit) => {
    if (!patient || busy) return;
    setBusy(true);
    setError(null);
    const result = await startAppointment(createClient(), patient.orgId, visit.id);
    setBusy(false);
    if (result.ok && result.consultationId) {
      router.push(`/consultas/${result.consultationId}`);
      return;
    }
    if (result.code === "active_consultation_exists" && result.consultationId) {
      router.push(`/consultas/${result.consultationId}`);
      return;
    }
    setError(t("agenda-start-error"));
    await load();
  };

  const setArchived = async (archive: boolean) => {
    if (!patient || busy) return;
    if (!archive && patient.deletionRequestedAt) return;
    if (archive && hasOpenWork) {
      setConfirmation(null);
      setError(t("patient-archive-open-work"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const values = archive
      ? { archived_at: new Date().toISOString(), archived_by: user?.id ?? null }
      : { archived_at: null, archived_by: null };
    const { error: updateError } = await supabase.from("patients").update(values).eq("id", patient.id);
    if (updateError) {
      setError(t("patient-archive-error"));
    } else {
      await recordAudit(supabase, archive ? "patient.archived" : "patient.restored", {
        orgId: patient.orgId,
        entityType: "patient",
        entityId: patient.id,
      });
      enqueueSnackbar(t(archive ? "patient-archive-success" : "patient-restore-success"), { variant: "success" });
      await load();
    }
    setConfirmation(null);
    setBusy(false);
  };

  const requestDeletion = async () => {
    if (!patient || busy) return;
    if (hasOpenWork) {
      setConfirmation(null);
      setError(t("patient-archive-open-work"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("patients")
      .update({
        deletion_requested_at: now,
        deletion_requested_by: user?.id ?? null,
        deletion_request_reason: deletionReason.trim() || null,
        archived_at: patient.archivedAt ?? now,
        archived_by: patient.archivedAt ? undefined : (user?.id ?? null),
      })
      .eq("id", patient.id);
    if (updateError) {
      setError(t("patient-deletion-error"));
    } else {
      await recordAudit(supabase, "patient.deletion_requested", {
        orgId: patient.orgId,
        entityType: "patient",
        entityId: patient.id,
        metadata: { hasReason: Boolean(deletionReason.trim()) },
      });
      enqueueSnackbar(t("patient-deletion-success"), { variant: "success" });
      await load();
    }
    setConfirmation(null);
    setDeletionReason("");
    setBusy(false);
  };

  if (loading) return <Skeleton variant="rounded" height={360} className="rounded-3xl" />;

  if (!patient) {
    return (
      <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
        {error ?? t("patient-not-found")}
      </Alert>
    );
  }

  const primaryLabel = activeVisit
    ? activeVisit.status === "awaiting_review"
      ? t("patient-review-consultation")
      : t("patient-resume-consultation")
    : nextScheduled
      ? t("patient-start-scheduled")
      : t("patient-start-consultation");

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h1" component="h1" className="mb-0">
              {patient.fullName}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("home-breadcrumb")}
              </Link>
              <Link color="inherit" href="/pacientes">
                {t("patients-title")}
              </Link>
              <Typography variant="body2">{patient.fullName}</Typography>
            </Breadcrumbs>
            {patient.importedFrom && (
              <Chip
                size="small"
                variant="outlined"
                className="mt-2"
                label={t("patient-imported", {
                  source: patient.importedFrom.source || t("patient-imported-unknown-source"),
                  date: new Intl.DateTimeFormat(locale).format(new Date(patient.importedFrom.at)),
                })}
              />
            )}
          </Box>

          {!patient.archivedAt && (
            <Box className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              {/* Case review in the library — Pro/trial only (route re-enforces). */}
              {audioAllowance?.clinicalReasoning && timelineItems.length > 0 && (
                <Button
                  variant="outlined"
                  color="grey"
                  startIcon={<NiBook />}
                  href={`/biblioteca?paciente=${patient.id}`}
                  LinkComponent={Link}
                  className="w-full sm:w-auto"
                >
                  {t("patient-study-case")}
                </Button>
              )}
              <Button
                variant="outlined"
                color="grey"
                startIcon={<NiCalendar />}
                onClick={() => setScheduleOpen(true)}
                className="w-full sm:w-auto"
              >
                {t("patient-schedule-consultation")}
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={runPrimaryAction}
                disabled={busy}
                className="w-full sm:w-auto"
              >
                {primaryLabel}
              </Button>
            </Box>
          )}
        </Box>
      </Grid>

      {patient.archivedAt && (
        <Grid size={12}>
          <Alert
            severity="info"
            action={
              patient.deletionRequestedAt ? undefined : (
                <Button color="inherit" onClick={() => setArchived(false)} disabled={busy}>
                  {t("patient-restore")}
                </Button>
              )
            }
          >
            {t("patient-archived-notice")}
          </Alert>
        </Grid>
      )}

      {patient.deletionRequestedAt && (
        <Grid size={12}>
          <Alert severity="warning">{t("patient-deletion-pending")}</Alert>
        </Grid>
      )}

      {patient.alerts.length > 0 && (
        <Grid size={12}>
          <Box className="flex flex-row flex-wrap gap-2">
            {patient.alerts.map((alert) => (
              <span
                key={alert.label}
                className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light rounded-full px-3 py-1.5 text-sm font-semibold"
              >
                {alert.label}
              </span>
            ))}
          </Box>
        </Grid>
      )}

      {error && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        </Grid>
      )}

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-3">
            <Typography variant="h5" component="h2" className="card-title">
              {t("patient-timeline-title")}
            </Typography>
            {timelineItems.length === 0 ? (
              <EmptyState
                illustration={<IllustrationLaunch />}
                titleAs="h3"
                framed={false}
                title={t("patient-timeline-empty-title")}
                description={t("patient-timeline-empty-body")}
              />
            ) : (
              <Timeline>
                {timelineItems.map((item, index) => {
                  const visual = eventVisual(item);
                  const first = index === 0;
                  const last = index === timelineItems.length - 1;
                  const occurredAt = new Date(item.occurredAt);
                  const dateLabel = dateFormat.format(occurredAt);
                  const timeLabel =
                    item.kind === "artifact" || item.visit.scheduledFor ? timeFormat.format(occurredAt) : null;
                  // Shown inside the row on a narrow screen and read by a screen
                  // reader everywhere: the rail column is aria-hidden, so without
                  // this twelve weekly "Dor lombar, Finalizada" links sound alike.
                  const whenLabel = timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;

                  if (item.kind === "artifact") {
                    const artifact = item.artifact;
                    const content = (
                      <>
                        <Box className="w-full min-w-0 flex-1">
                          <Typography variant="body1" className="text-text-primary truncate font-medium">
                            {artifact.kind === "transcription"
                              ? t("patient-timeline-transcription")
                              : t("patient-timeline-document", {
                                  title: artifact.title,
                                  version: artifact.version,
                                })}
                          </Typography>
                          <Typography variant="body2" className="text-text-secondary block sm:sr-only">
                            {whenLabel}
                          </Typography>
                        </Box>
                        <span className="bg-primary/10 text-primary-dark dark:text-primary-light flex-none rounded-full px-2.5 py-1 text-xs font-semibold">
                          {artifact.kind === "transcription"
                            ? t("patient-timeline-transcription-chip")
                            : t(`patient-timeline-document-${artifact.status}`)}
                        </span>
                      </>
                    );

                    return (
                      <TimelineEvent
                        key={`${artifact.kind}-${artifact.id}`}
                        dateLabel={dateLabel}
                        timeLabel={timeLabel}
                        tone={visual.tone}
                        icon={visual.icon}
                        first={first}
                        last={last}
                      >
                        <Link
                          href={
                            artifact.kind === "transcription"
                              ? `/consultas/${artifact.consultationId}#transcription-${artifact.id}`
                              : `/verify/${artifact.verifyCode}`
                          }
                          className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3"
                        >
                          {content}
                        </Link>
                      </TimelineEvent>
                    );
                  }

                  const visit = item.visit;
                  const content = (
                    <>
                      <Box className="w-full min-w-0 flex-1">
                        <Typography variant="body1" className="text-text-primary truncate font-medium">
                          {/* An imported record has no complaint field — showing
                              "sem queixa registrada" would describe it as an
                              empty consultation instead of a record from
                              elsewhere. Its own first line is the honest title. */}
                          {visit.legacyBody
                            ? visit.legacyBody.split("\n")[0]
                            : visit.appointmentNote || visit.chiefComplaint || t("consultation-no-complaint")}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary block sm:sr-only">
                          {whenLabel}
                        </Typography>
                        {/* The rail already carries the date on a wide screen, so this
                            line says only what the date cannot: the record came from
                            somewhere else. */}
                        {visit.legacyBody && (
                          <Typography variant="body2" className="text-text-secondary">
                            {visit.legacySource
                              ? t("legacy-record-from", { source: visit.legacySource })
                              : t("legacy-record-unknown-source")}
                          </Typography>
                        )}
                      </Box>
                      <StatusChip status={visit.status} label={t(`status-${visit.status}`)} />
                    </>
                  );

                  return (
                    <TimelineEvent
                      key={visit.id}
                      dateLabel={dateLabel}
                      timeLabel={timeLabel}
                      tone={visual.tone}
                      icon={visual.icon}
                      first={first}
                      last={last}
                    >
                      {visit.status === "scheduled" ? (
                        // A row that carries its own action cannot be a link: a
                        // <button> inside an <a> is invalid and traps the keyboard.
                        <Box className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors md:flex-row md:flex-wrap md:items-center md:gap-3">
                          {content}
                          <Button
                            size="small"
                            aria-label={`${t("agenda-start")} ${whenLabel}`}
                            onClick={() => startScheduledVisit(visit)}
                            disabled={busy}
                          >
                            {t("agenda-start")}
                          </Button>
                        </Box>
                      ) : visit.status === "cancelled" ? (
                        // A cancelled visit leads nowhere — no hover, no affordance.
                        <Box className="flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                          {content}
                        </Box>
                      ) : (
                        <Link
                          href={`/consultas/${visit.id}`}
                          className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3"
                        >
                          {content}
                        </Link>
                      )}
                    </TimelineEvent>
                  );
                })}
              </Timeline>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }} className="flex flex-col gap-5">
        <Card component="section">
          <CardContent className="flex flex-col gap-3">
            <Box className="flex flex-row items-start justify-between gap-2">
              <Typography variant="h5" component="h2" className="card-title mb-0">
                {t("patient-data-title")}
              </Typography>
              {!patient.archivedAt && (
                <Button
                  variant="text"
                  size="small"
                  startIcon={<NiPen size="small" />}
                  onClick={() => setEditOpen(true)}
                >
                  {t("patient-edit")}
                </Button>
              )}
            </Box>
            <Field
              label={t("patient-birth")}
              value={patient.birthDate ? formatDate(patient.birthDate, locale) : null}
            />
            <Field label={t("patient-phone")} value={patient.phone ? formatPhoneBr(patient.phone) : null} />
            <Field label={t("patient-cpf")} value={patient.document ? formatCpf(patient.document) : null} />
            <Field label={t("patient-email")} value={patient.email} />
            <Field label={t("patient-notes")} value={patient.notes} />
            {patient.fertilityCare && (
              <Field label={t("patient-fertility-care")} value={t("patient-fertility-care-on")} />
            )}
            <Button
              variant="text"
              className="self-start"
              href={`/pacientes/${patient.id}/consentimentos`}
              LinkComponent={Link}
            >
              {t("consent-title")}
            </Button>
          </CardContent>
        </Card>

        <Card component="section">
          <CardContent className="flex flex-col gap-2">
            <Typography variant="h6" component="h2">
              {t("patient-record-actions")}
            </Typography>
            {/* Portability is not a feature of a plan: taking her own records
                away works on any tier, and while the account is in arrears or
                archived (PRD §9.10). The route is the only gate — RLS. */}
            <Typography variant="body2" className="text-text-secondary">
              {t("patient-export-hint")}
            </Typography>
            <Button
              variant="text"
              color="grey"
              startIcon={<NiDownloadCloud />}
              href={`/api/patients/${patient.id}/export?format=pdf`}
              className="self-start"
            >
              {t("patient-export")}
            </Button>
            <Button
              variant="text"
              color="grey"
              startIcon={<NiDownloadCloud />}
              href={`/api/patients/${patient.id}/export?format=json`}
              className="self-start"
            >
              {t("patient-export-json")}
            </Button>
            {!patient.archivedAt && (
              <Button
                variant="text"
                color="grey"
                startIcon={<NiArchive />}
                onClick={() => setConfirmation("archive")}
                className="self-start"
              >
                {t("patient-archive")}
              </Button>
            )}
            {!patient.deletionRequestedAt && (
              <Button variant="text" color="error" onClick={() => setConfirmation("deletion")} className="self-start">
                {t("patient-request-deletion")}
              </Button>
            )}
          </CardContent>
        </Card>
      </Grid>

      <PatientEditDialog
        open={editOpen}
        patient={patient}
        onClose={() => setEditOpen(false)}
        onSaved={async () => {
          enqueueSnackbar(t("patient-edit-success"), { variant: "success" });
          await load();
        }}
      />

      <ScheduleDialog
        open={scheduleOpen}
        orgId={orgId ?? patient.orgId}
        timeZone={timezone}
        seed={{
          patientId: patient.id,
          startAt: defaultAppointmentStart(new Date(), new Date(), timezone).toISOString(),
        }}
        onClose={() => setScheduleOpen(false)}
        onSaved={async (outcome) => {
          enqueueSnackbar(
            outcome.kind === "series"
              ? t("agenda-series-success", { count: outcome.createdCount })
              : t("agenda-schedule-success"),
            { variant: "success" },
          );
          if (outcome.kind === "series" && outcome.conflictCount > 0) {
            enqueueSnackbar(t("agenda-series-conflict-count", { count: outcome.conflictCount }), {
              variant: "warning",
            });
          }
          await load();
        }}
      />

      <Dialog open={confirmation !== null} onClose={() => !busy && setConfirmation(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {confirmation === "archive" ? t("patient-archive-title") : t("patient-deletion-title")}
        </DialogTitle>
        <DialogContent className="flex flex-col gap-3 pt-2!">
          <Typography variant="body2" className="text-text-secondary">
            {confirmation === "archive" ? t("patient-archive-body") : t("patient-deletion-body")}
          </Typography>
          {confirmation === "deletion" && (
            <TextField
              label={t("patient-deletion-reason")}
              value={deletionReason}
              onChange={(event) => setDeletionReason(event.target.value)}
              multiline
              minRows={2}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmation(null)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color={confirmation === "deletion" ? "error" : "primary"}
            onClick={() => (confirmation === "archive" ? setArchived(true) : requestDeletion())}
            disabled={busy}
          >
            {confirmation === "archive" ? t("patient-archive-confirm") : t("patient-deletion-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}

const visitDate = (visit: Visit) => visit.scheduledFor ?? visit.startedAt;
const formatDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale).format(new Date(`${value}T00:00:00`));

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <Box>
      <Typography variant="body2" className="text-text-secondary">
        {label}
      </Typography>
      <Typography variant="body1" className="text-text-primary">
        {value || "—"}
      </Typography>
    </Box>
  );
}

/** The rail of the record: when it happened on the left, what it was on the
 *  marker, the event itself on the right. The row content belongs to the caller,
 *  so an event that carries its own action is never wrapped in a link. */
function TimelineEvent({
  dateLabel,
  timeLabel,
  tone,
  icon,
  first,
  last,
  children,
}: {
  dateLabel: string;
  timeLabel: string | null;
  tone: string;
  icon: ReactNode;
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  return (
    <TimelineItem>
      <TimelineOppositeContent
        aria-hidden
        className="m-auto hidden shrink-0 grow-0 basis-20 pr-2 pl-0 whitespace-nowrap sm:block"
      >
        <Typography variant="body2" className="text-text-primary font-medium">
          {dateLabel}
        </Typography>
        {timeLabel && (
          <Typography variant="caption" className="text-text-secondary block">
            {timeLabel}
          </Typography>
        )}
      </TimelineOppositeContent>
      <TimelineSeparator>
        {/* The rail stops at the ends: a stub above the newest event would
            promise history that is not there. It stays in the layout, just not
            painted, so every marker sits at the same height. */}
        <TimelineConnector className={first ? "invisible" : undefined} />
        <TimelineDot aria-hidden className={`my-1 rounded-lg p-2 ${tone}`}>
          {icon}
        </TimelineDot>
        <TimelineConnector className={last ? "invisible" : undefined} />
      </TimelineSeparator>
      <TimelineContent className="my-auto min-w-0 py-0 pr-0 pl-2">{children}</TimelineContent>
    </TimelineItem>
  );
}

function StatusChip({ status, label }: { status: string; label: string }) {
  const style =
    status === "finalized"
      ? "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
      : "bg-grey-100 text-text-secondary";
  return <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}
