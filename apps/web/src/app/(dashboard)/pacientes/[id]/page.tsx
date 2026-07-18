"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PatientEditDialog from "@/components/product/patient-edit-dialog";
import ScheduleDialog from "@/components/product/schedule-dialog";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiArchive from "@/icons/nexture/ni-archive";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiPen from "@/icons/nexture/ni-pen";
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
        .select("id, status, started_at, scheduled_for, duration_minutes, chief_complaint, appointment_note, summary")
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

  const exportPatient = async () => {
    if (!patient) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      patient: {
        name: patient.fullName,
        birthDate: patient.birthDate,
        phone: patient.phone,
        document: patient.document,
        email: patient.email,
        notes: patient.notes,
        alerts: patient.alerts,
      },
      consultations: visits.map((visit) => ({
        status: visit.status,
        date: visit.scheduledFor ?? visit.startedAt,
        durationMinutes: visit.durationMinutes,
        appointmentNote: visit.appointmentNote,
        chiefComplaint: visit.chiefComplaint,
        summary: visit.summary,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `paciente-${patient.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    await recordAudit(createClient(), "patient.exported", {
      orgId: patient.orgId,
      entityType: "patient",
      entityId: patient.id,
    });
    enqueueSnackbar(t("patient-export-success"), { variant: "success" });
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
          </Box>

          {!patient.archivedAt && (
            <Box className="flex flex-row flex-wrap gap-2">
              {/* Case review in the library — Pro/trial only (route re-enforces). */}
              {audioAllowance?.clinicalReasoning && (
                <Button
                  variant="outlined"
                  color="grey"
                  startIcon={<NiBook />}
                  href={`/biblioteca?paciente=${patient.id}`}
                  LinkComponent={Link}
                >
                  {t("patient-study-case")}
                </Button>
              )}
              <Button variant="outlined" color="grey" startIcon={<NiCalendar />} onClick={() => setScheduleOpen(true)}>
                {t("patient-schedule-consultation")}
              </Button>
              <Button variant="contained" color="primary" onClick={runPrimaryAction} disabled={busy}>
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
                icon={<NiClipboard />}
                title={t("patient-timeline-empty-title")}
                description={t("patient-timeline-empty-body")}
                action={
                  patient.archivedAt
                    ? undefined
                    : { label: t("patient-start-consultation"), onClick: createConsultation }
                }
                className="border-none py-8"
              />
            ) : (
              <Box className="flex flex-col gap-1">
                {timelineItems.map((item) => {
                  if (item.kind === "artifact") {
                    const artifact = item.artifact;
                    const content = (
                      <>
                        <Box className="min-w-0 flex-1">
                          <Typography variant="body1" className="text-text-primary truncate font-medium">
                            {artifact.kind === "transcription"
                              ? t("patient-timeline-transcription")
                              : t("patient-timeline-document", {
                                  title: artifact.title,
                                  version: artifact.version,
                                })}
                          </Typography>
                          <Typography variant="body2" className="text-text-secondary">
                            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                              new Date(artifact.occurredAt),
                            )}
                          </Typography>
                        </Box>
                        <span className="bg-primary/10 text-primary-dark dark:text-primary-light rounded-full px-2.5 py-1 text-xs font-semibold">
                          {artifact.kind === "transcription"
                            ? t("patient-timeline-transcription-chip")
                            : t(`patient-timeline-document-${artifact.status}`)}
                        </span>
                      </>
                    );

                    return artifact.kind === "transcription" ? (
                      <Link
                        key={`transcription-${artifact.id}`}
                        href={`/consultas/${artifact.consultationId}#transcription-${artifact.id}`}
                        className="hover:bg-grey-25 flex flex-row items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
                      >
                        {content}
                      </Link>
                    ) : (
                      <Link
                        key={`document-${artifact.id}`}
                        href={`/verify/${artifact.verifyCode}`}
                        className="hover:bg-grey-25 flex flex-row items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
                      >
                        {content}
                      </Link>
                    );
                  }

                  const visit = item.visit;
                  const content = (
                    <>
                      <Box className="min-w-0 flex-1">
                        <Typography variant="body1" className="text-text-primary truncate font-medium">
                          {visit.appointmentNote || visit.chiefComplaint || t("consultation-no-complaint")}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: visit.scheduledFor ? "short" : undefined,
                          }).format(new Date(visitDate(visit)))}
                        </Typography>
                      </Box>
                      <StatusChip status={visit.status} label={t(`status-${visit.status}`)} />
                    </>
                  );

                  if (visit.status === "scheduled") {
                    return (
                      <Box
                        key={visit.id}
                        className="hover:bg-grey-25 flex flex-row flex-wrap items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
                      >
                        {content}
                        <Button size="small" onClick={() => startScheduledVisit(visit)} disabled={busy}>
                          {t("agenda-start")}
                        </Button>
                      </Box>
                    );
                  }

                  if (visit.status === "cancelled") {
                    return (
                      <Box key={visit.id} className="flex flex-row items-center gap-3 rounded-2xl px-3 py-3">
                        {content}
                      </Box>
                    );
                  }

                  return (
                    <Link
                      key={visit.id}
                      href={`/consultas/${visit.id}`}
                      className="hover:bg-grey-25 flex flex-row items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
                    >
                      {content}
                    </Link>
                  );
                })}
              </Box>
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
            <Button
              variant="text"
              color="grey"
              startIcon={<NiDownloadCloud />}
              onClick={exportPatient}
              className="self-start"
            >
              {t("patient-export")}
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

function StatusChip({ status, label }: { status: string; label: string }) {
  const style =
    status === "finalized"
      ? "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
      : "bg-grey-100 text-text-secondary";
  return <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}
