"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  Input,
  Popover,
  Skeleton,
  Typography,
} from "@mui/material";

import ClinicalContextBar from "@/components/product/clinical-context-bar";
import ConsentCollectionDialog from "@/components/product/consent-collection-dialog";
import ConsultationRecorder from "@/components/product/consultation-recorder";
import HypothesesPanel from "@/components/product/hypotheses-panel";
import PlanPanel from "@/components/product/plan-panel";
import RecordingsPanel from "@/components/product/recordings-panel";
import ScheduleDialog, { type ScheduleSeed } from "@/components/product/schedule-dialog";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiPlay from "@/icons/nexture/ni-play";
import { calendarDateInTimeZone, defaultAppointmentStart, weeklyOccurrences } from "@/lib/agenda";
import { ANAMNESIS_BLOCKS, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { recordAudit } from "@/lib/audit";
import {
  ConsultationSaveCoordinator,
  type ConsultationSaveSnapshot,
  NonRetryableSaveError,
  useConsultationTabGuard,
} from "@/lib/consultation-save-coordinator";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import {
  type ConsultationStatus,
  deriveConsultationCapabilities,
  deriveConsultationState,
  type RecordingStatus,
} from "@flyee/clinical";

type Provenance = { quote?: string; start?: string; speaker?: string };
type FieldMeta = { value: string; state: string; source: string; provenance: Provenance };

type Consultation = {
  id: string;
  orgId: string;
  patientId: string;
  patientName: string;
  status: ConsultationStatus;
  chiefComplaint: string | null;
  summary: string | null;
  startedAt: string;
  scheduledFor: string | null;
  clinicalRevision: number;
  aiGaps: string[];
};

type Addendum = { id: string; body: string; reason: string | null; createdAt: string };
type ConsultationContext = {
  patient: { birthDate: string | null; alerts: { label: string }[] };
  consents: { audio: boolean; ai: boolean; images: boolean };
  recording: { id: string; status: RecordingStatus; updatedAt: string } | null;
};
type FinalizeSummary = { draftHypotheses: number; draftPlans: number };
type FinalizeResponse = {
  ok?: boolean;
  error?: { code?: string; details?: { warnings?: string[]; revision?: number } };
};

/**
 * The consultation record (PRD §8.3/§10.6/§8.5). The job: review what the AI
 * drafted (or type it manually), decide, and close the record.
 *
 * The AI never produces a fact — it produces a DRAFT with, per field, a review
 * STATE and an ORIGIN, plus PROVENANCE (the transcript excerpt it came from):
 *  - state: clear (evidence) / attention (ambiguous/sensitive) / edited (the
 *    professional changed it) — surfaced as a chip so review focuses on what
 *    needs it (PRD §10.6);
 *  - origin: patient report vs practitioner observation vs AI inference stay
 *    visually distinct (PRD §10.3);
 *  - editing a field flips it to the professional's own words (source
 *    professional, state edited), so a human decision is never mistaken for AI.
 *
 * Two DB-enforced rules the UI keeps honest: a blank field is "não informado"
 * (clearing DELETES the answer, PRD §10.5), and a finalized record is frozen
 * (corrections are addenda, PRD §8.5).
 */
export default function ConsultaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const { timezone } = useCurrentOrg();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnSeed, setReturnSeed] = useState<ScheduleSeed | undefined>();
  // Reasoning is the Pro layer (PRD §10.8) — the same allowance that governs
  // minutes says whether this workspace has it.
  const {
    allowance,
    loading: allowanceLoading,
    error: allowanceError,
    reload: reloadAllowance,
  } = useAudioAllowance(consultation?.orgId ?? null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fields, setFields] = useState<Record<string, FieldMeta>>({});
  const [headerDraft, setHeaderDraft] = useState({ chiefComplaint: "", summary: "" });
  const [context, setContext] = useState<ConsultationContext | null>(null);
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saveSnapshot, setSaveSnapshot] = useState<ConsultationSaveSnapshot>({
    state: "idle",
    pending: 0,
    failed: 0,
  });
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeSummary, setFinalizeSummary] = useState<FinalizeSummary>({ draftHypotheses: 0, draftPlans: 0 });
  const [finalizeWarnings, setFinalizeWarnings] = useState<string[]>([]);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>([]);
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [consentCollectionOpen, setConsentCollectionOpen] = useState(false);
  const [addendumBody, setAddendumBody] = useState("");
  const [addendumReason, setAddendumReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [provenanceAnchor, setProvenanceAnchor] = useState<{ el: HTMLElement; data: Provenance } | null>(null);
  const [recordingsRefresh, setRecordingsRefresh] = useState(0);
  const revisionRef = useRef(0);

  const { isPrimary, takeOver } = useConsultationTabGuard(params.id);
  const saveCoordinator = useMemo(
    () =>
      new ConsultationSaveCoordinator({
        debounceMs: 550,
        retryCount: 2,
        onStateChange: setSaveSnapshot,
      }),
    [],
  );

  useEffect(() => () => saveCoordinator.dispose(), [saveCoordinator]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saveCoordinator.hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveCoordinator]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setErrorKey("consultation-load-error");
      setLoadFailed(true);
      return;
    }
    const supabase = createClient();
    const [consultationResult, answersResult, addendaResult, contextResponse] = await Promise.all([
      supabase
        .from("consultations")
        .select(
          "id, org_id, patient_id, status, chief_complaint, summary, started_at, scheduled_for, clinical_revision, ai_gaps, patients(full_name)",
        )
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("anamnesis_answers")
        .select("block_key, field_key, value, state, source, provenance")
        .eq("consultation_id", params.id),
      supabase
        .from("consultation_addenda")
        .select("id, body, reason, created_at")
        .eq("consultation_id", params.id)
        .order("created_at"),
      fetch(`/api/consultations/${params.id}/context`).catch(() => null),
    ]);

    const { data: row, error: consultationError } = consultationResult;
    const { data: answerRows, error: answersError } = answersResult;
    const { data: addendaRows, error: addendaError } = addendaResult;
    if (consultationError || answersError || addendaError || !row) {
      setErrorKey("consultation-load-error");
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);

    const patient = row.patients as unknown as { full_name: string } | null;
    const loadedConsultation: Consultation = {
      id: row.id,
      orgId: row.org_id,
      patientId: row.patient_id,
      patientName: patient?.full_name ?? "—",
      status: row.status as ConsultationStatus,
      chiefComplaint: row.chief_complaint,
      summary: row.summary,
      startedAt: row.started_at,
      scheduledFor: row.scheduled_for,
      clinicalRevision: Number(row.clinical_revision ?? 0),
      aiGaps: (row.ai_gaps as string[] | null) ?? [],
    };
    revisionRef.current = loadedConsultation.clinicalRevision;
    setConsultation(loadedConsultation);

    const contextBody = (await contextResponse?.json().catch(() => null)) as
      | ({ ok?: boolean } & ConsultationContext)
      | null;
    if (contextResponse?.ok && contextBody?.ok) {
      setContext({ patient: contextBody.patient, consents: contextBody.consents, recording: contextBody.recording });
      setErrorKey(null);
    } else {
      setErrorKey("consultation-context-load-error");
    }

    const map: Record<string, FieldMeta> = {};
    for (const answer of answerRows ?? []) {
      const composite = `${answer.block_key}.${answer.field_key}`;
      map[composite] = {
        value: answer.value as string,
        state: (answer.state as string) ?? "clear",
        source: (answer.source as string) ?? "professional",
        provenance: (answer.provenance as Provenance) ?? {},
      };
    }
    if (!saveCoordinator.hasUnsavedChanges()) {
      setFields(map);
      const nextHeader = { chiefComplaint: row.chief_complaint ?? "", summary: row.summary ?? "" };
      setHeaderDraft(nextHeader);
    }

    setAddenda(
      (addendaRows ?? []).map((addendum) => ({
        id: addendum.id,
        body: addendum.body,
        reason: addendum.reason,
        createdAt: addendum.created_at,
      })),
    );
  }, [params.id, saveCoordinator]);

  useEffect(() => {
    void load();
  }, [load]);

  // A capture finishes OUT OF BAND with this open tab, in two ways the page
  // cannot otherwise see: the AI pipeline drafts the anamnesis in a background
  // job, and a recording can be captured on the PHONE while she has the record
  // open on the computer. Nothing pushes to an open tab, so without this the
  // drafted anamnesis and the phone's live capture state never appear until a
  // manual refresh. Poll lightly while the record is still open, pause while
  // the tab is hidden (no work when she isn't looking), and re-sync the moment
  // it regains focus — the exact instant she walks back from the phone to the
  // computer. Never fight the autosave: skip a tick with unsaved edits.
  const syncFromServer = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (saveCoordinator.hasUnsavedChanges()) return;
    void load();
    setRecordingsRefresh((value) => value + 1);
  }, [load, saveCoordinator]);

  useEffect(() => {
    const status = consultation?.status;
    if (!status || status === "finalized" || status === "cancelled") return;
    const interval = window.setInterval(syncFromServer, 12_000);
    const onVisible = () => syncFromServer();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [consultation?.status, syncFromServer]);

  const isFinalized = consultation?.status === "finalized";
  const recordingStatus = context?.recording?.status ?? null;
  /** A capture is in flight, so the AI will draft over this record shortly. */
  const captureInFlight = Boolean(
    recordingStatus && ["recording", "local", "uploading", "uploaded", "processing"].includes(recordingStatus),
  );
  const experience = consultation
    ? deriveConsultationState(
        { status: consultation.status },
        recordingStatus ? [{ status: recordingStatus, createdAt: context?.recording?.updatedAt }] : [],
      )
    : "manual_draft";
  const capabilities = consultation
    ? deriveConsultationCapabilities({ consultationStatus: consultation.status, recordingStatus })
    : null;
  const canEdit = Boolean(capabilities?.canEditClinicalRecord && isPrimary && !busy);
  const isReadOnly = !canEdit;

  useEffect(() => {
    if (saveSnapshot.state === "error") {
      setErrorKey((current) => (current === "consultation-revision-conflict" ? current : "consultation-save-error"));
    }
    if (saveSnapshot.state === "saved") {
      setErrorKey((current) => (current === "consultation-save-error" ? null : current));
    }
  }, [saveSnapshot.state]);

  const queueAnswerSave = (blockKey: string, fieldKey: string, value: string) => {
    if (!consultation || !canEdit) return;
    const composite = `${blockKey}.${fieldKey}`;
    const previous = fields[composite];
    const trimmedValue = value.trim();
    const wasAi = previous?.source === "ai_inference" || previous?.source === "patient_report";
    const source = PROFESSIONAL_OBSERVATION_FIELDS.has(composite) ? "professional_voice" : "professional";
    const state = wasAi ? "edited" : "clear";
    setErrorKey(null);
    setFields((current) => ({
      ...current,
      [composite]: current[composite]
        ? { ...current[composite], value }
        : { value, state: "clear", source: "professional", provenance: {} },
    }));

    saveCoordinator.schedule(`answer:${composite}`, async () => {
      const supabase = createClient();
      const expectedRevision = revisionRef.current;
      const { data, error } = await supabase.rpc("save_consultation_answer", {
        target_consultation: consultation.id,
        expected_revision: expectedRevision,
        target_block_key: blockKey,
        target_field_key: fieldKey,
        target_value: trimmedValue,
        target_source: source,
        target_state: state,
      });
      if (error) throw new Error("save_failed");
      const result = data as { ok?: boolean; code?: string; revision?: number } | null;
      if (!result?.ok || !Number.isInteger(result.revision)) {
        if (result?.code === "revision_conflict" && Number.isInteger(result.revision)) {
          const { data: persisted, error: persistedError } = await supabase
            .from("anamnesis_answers")
            .select("value")
            .eq("consultation_id", consultation.id)
            .eq("block_key", blockKey)
            .eq("field_key", fieldKey)
            .maybeSingle();
          if (!persistedError && (persisted?.value?.trim() ?? "") === trimmedValue) {
            revisionRef.current = Number(result.revision);
            return;
          }
          setErrorKey("consultation-revision-conflict");
          void load().finally(() => setErrorKey("consultation-revision-conflict"));
          throw new NonRetryableSaveError("revision_conflict");
        }
        throw new Error("save_failed");
      }
      revisionRef.current = Number(result.revision);
      setFields((current) => {
        const currentValue = current[composite]?.value ?? "";
        if (currentValue.trim() !== trimmedValue) return current;
        return { ...current, [composite]: { ...current[composite], value: currentValue, source, state } };
      });
    });
  };

  const queueHeaderSave = (field: "chiefComplaint" | "summary", value: string) => {
    if (!consultation || !canEdit) return;
    setHeaderDraft((current) => ({ ...current, [field]: value }));
    setErrorKey(null);
    const databaseField = field === "chiefComplaint" ? "chief_complaint" : "summary";
    saveCoordinator.schedule(`header:${field}`, async () => {
      const supabase = createClient();
      const expectedRevision = revisionRef.current;
      const desiredValue = value.trim();
      const { data, error } = await supabase.rpc("save_consultation_header", {
        target_consultation: consultation.id,
        expected_revision: expectedRevision,
        target_field: databaseField,
        target_value: desiredValue,
      });
      if (error) throw new Error("save_failed");
      const result = data as { ok?: boolean; code?: string; revision?: number } | null;
      if (!result?.ok || !Number.isInteger(result.revision)) {
        if (result?.code === "revision_conflict" && Number.isInteger(result.revision)) {
          const { data: persisted, error: persistedError } = await supabase
            .from("consultations")
            .select("chief_complaint, summary")
            .eq("id", consultation.id)
            .maybeSingle();
          const persistedValue = databaseField === "chief_complaint" ? persisted?.chief_complaint : persisted?.summary;
          if (!persistedError && String(persistedValue ?? "").trim() === desiredValue) {
            revisionRef.current = Number(result.revision);
            return;
          }
          setErrorKey("consultation-revision-conflict");
          void load().finally(() => setErrorKey("consultation-revision-conflict"));
          throw new NonRetryableSaveError("revision_conflict");
        }
        throw new Error("save_failed");
      }
      revisionRef.current = Number(result.revision);
    });
  };

  const consultationIsEmpty =
    Object.values(fields).every((meta) => !meta.value.trim()) &&
    !headerDraft.chiefComplaint.trim() &&
    !headerDraft.summary.trim();

  const prepareFinalize = async () => {
    if (!consultation || !capabilities?.canFinalize) return;
    setErrorKey(null);
    setFinalizeWarnings([]);
    setAcknowledgedWarnings([]);
    setEmptyConfirmed(false);
    const supabase = createClient();
    const [hypothesesResult, plansResult] = await Promise.all([
      supabase
        .from("consultation_hypotheses")
        .select("id", { count: "exact", head: true })
        .eq("consultation_id", consultation.id)
        .eq("status", "draft"),
      supabase
        .from("consultation_plans")
        .select("id", { count: "exact", head: true })
        .eq("consultation_id", consultation.id)
        .eq("status", "draft"),
    ]);
    if (hypothesesResult.error || plansResult.error) {
      setErrorKey("consultation-finalize-summary-error");
      return;
    }
    const summary = { draftHypotheses: hypothesesResult.count ?? 0, draftPlans: plansResult.count ?? 0 };
    setFinalizeSummary(summary);
    setFinalizeWarnings([
      ...(Object.values(fields).some((meta) => meta.state === "attention") ? ["attention_fields"] : []),
      ...(summary.draftHypotheses ? ["draft_hypotheses"] : []),
      ...(summary.draftPlans ? ["draft_plan"] : []),
    ]);
    setFinalizeOpen(true);
  };

  const finalize = async () => {
    if (!consultation || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      // `retry()` is also a flush when there are no failed writes. Calling it
      // unconditionally closes the small React-state timing window between a
      // rejected write and the visible error indicator.
      await saveCoordinator.retry();
    } catch {
      setErrorKey("consultation-save-before-finalize");
      setBusy(false);
      return;
    }

    try {
      const contextResponse = await fetch(`/api/consultations/${consultation.id}/context`);
      const contextBody = await contextResponse.json().catch(() => ({}));
      const revision = contextBody?.consultation?.clinicalRevision;
      if (!contextResponse.ok || !Number.isInteger(revision)) {
        setErrorKey("consultation-finalize-error");
        setBusy(false);
        return;
      }

      const confirmedWarnings = [
        ...acknowledgedWarnings,
        ...(consultationIsEmpty && emptyConfirmed ? ["empty_consultation"] : []),
      ];
      const response = await fetch(`/api/consultations/${consultation.id}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision, acknowledgedWarnings: confirmedWarnings }),
      });
      const body = (await response.json().catch(() => ({}))) as FinalizeResponse;
      if (!response.ok) {
        const code = body.error?.code;
        const warnings = body?.error?.details?.warnings;
        if (code === "finalization_confirmation_required" && Array.isArray(warnings)) {
          const safeWarnings = warnings.filter((warning: unknown): warning is string => typeof warning === "string");
          setFinalizeWarnings(safeWarnings.filter((warning) => warning !== "empty_consultation"));
          if (safeWarnings.includes("empty_consultation")) setEmptyConfirmed(false);
          setAcknowledgedWarnings([]);
          setErrorKey("consultation-finalize-review-warnings");
        } else if (code === "clinical_revision_conflict") {
          await load();
          setErrorKey("consultation-revision-conflict");
        } else {
          setErrorKey(code === "recording_pending" ? "consultation-recording-pending" : "consultation-finalize-error");
        }
        setBusy(false);
        return;
      }

      setFinalizeOpen(false);
      setFinalizeWarnings([]);
      setAcknowledgedWarnings([]);
      setBusy(false);
      await load();
      router.refresh();
    } catch {
      setErrorKey("consultation-finalize-error");
      setBusy(false);
    }
  };

  const addAddendum = async () => {
    if (!consultation || !addendumBody.trim() || busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from("consultation_addenda").insert({
      org_id: consultation.orgId,
      consultation_id: consultation.id,
      body: addendumBody.trim(),
      reason: addendumReason.trim() || null,
      created_by: user?.id ?? null,
    });
    if (insertError) setErrorKey("consultation-addendum-error");
    else {
      recordAudit(supabase, "consultation.addendum.created", {
        orgId: consultation.orgId,
        entityType: "consultation",
        entityId: consultation.id,
      });
      setAddendumBody("");
      setAddendumReason("");
      setAddendumOpen(false);
      await load();
    }
    setBusy(false);
  };

  const filledCount = useMemo(() => Object.values(fields).filter((meta) => meta.value.trim()).length, [fields]);
  const attentionCount = useMemo(
    () => Object.values(fields).filter((meta) => meta.state === "attention").length,
    [fields],
  );
  const nextAction =
    saveSnapshot.state === "error"
      ? t("context-next-retry-save")
      : experience === "scheduled"
        ? t("context-next-start")
        : experience === "awaiting_review"
          ? t("context-next-review")
          : experience === "processing" || experience === "uploading" || experience === "awaiting_upload"
            ? t("context-next-wait-recording")
            : experience === "failed"
              ? t("context-next-recover-recording")
              : experience === "finalized"
                ? t("context-next-finalized")
                : experience === "cancelled"
                  ? t("context-next-cancelled")
                  : t("context-next-continue");
  const allWarningsAcknowledged = finalizeWarnings.every((warning) => acknowledgedWarnings.includes(warning));

  if (!consultation && loadFailed) {
    return (
      <Alert
        severity="error"
        className="neutral bg-background-paper/60!"
        action={<Button onClick={load}>{t("retry")}</Button>}
      >
        {t("consultation-load-error")}
      </Alert>
    );
  }

  if (!consultation) {
    return <Skeleton variant="rounded" height={420} className="rounded-3xl" />;
  }

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h1" component="h1" className="mb-0">
              {consultation.patientName}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("home-breadcrumb")}
              </Link>
              <Link color="inherit" href={`/pacientes/${consultation.patientId}`}>
                {consultation.patientName}
              </Link>
              <Typography variant="body2">{new Date(consultation.startedAt).toLocaleDateString()}</Typography>
            </Breadcrumbs>
          </Box>

          {isFinalized ? (
            <Button variant="outlined" color="grey" onClick={() => setAddendumOpen(true)}>
              {t("consultation-add-addendum")}
            </Button>
          ) : null}
        </Box>
      </Grid>

      <Grid size={12} className="sticky top-20 z-20">
        <ClinicalContextBar
          patientId={consultation.patientId}
          patientName={consultation.patientName}
          patientBirthDate={context?.patient.birthDate}
          alerts={context?.patient.alerts ?? []}
          scheduledFor={consultation.scheduledFor ?? consultation.startedAt}
          experience={experience}
          consents={context?.consents ?? { audio: false, ai: false }}
          saveState={saveSnapshot.state}
          recordingStatus={recordingStatus}
          nextAction={nextAction}
          onRetrySave={() => void saveCoordinator.retry().catch(() => setErrorKey("consultation-save-error"))}
          primaryAction={
            !isFinalized && capabilities?.canFinalize && isPrimary
              ? {
                  label: t("consultation-review-finalize"),
                  onClick: prepareFinalize,
                  disabled: busy,
                  variant: consultationIsEmpty && consultation.status !== "awaiting_review" ? "outlined" : "contained",
                }
              : undefined
          }
        />
      </Grid>

      {/* An AI-drafted consultation says so, and points review at the exceptions. */}
      {consultation.status === "awaiting_review" && (
        <Grid size={12}>
          <Alert severity="info" icon={<NiListCheck />} className="neutral bg-background-paper/60!">
            {attentionCount > 0
              ? t("consultation-review-attention", { count: attentionCount })
              : t("consultation-review-ready")}
          </Alert>
        </Grid>
      )}

      {isFinalized && (
        <Grid size={12}>
          <Alert
            severity="success"
            icon={<NiLock />}
            className="neutral bg-background-paper/60!"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  // "Same time next week" as the wall-clock suggestion; an old
                  // record being closed late falls back to the next free-form slot.
                  const base = consultation.scheduledFor ?? consultation.startedAt;
                  const suggestion = weeklyOccurrences(base, 2, timezone)[1];
                  const startAt =
                    suggestion.getTime() > Date.now()
                      ? suggestion
                      : defaultAppointmentStart(calendarDateInTimeZone(new Date(), timezone), new Date(), timezone);
                  setReturnSeed({ patientId: consultation.patientId, startAt: startAt.toISOString() });
                  setReturnDialogOpen(true);
                }}
              >
                {t("consultation-schedule-return")}
              </Button>
            }
          >
            {t("consultation-finalized-notice")}
          </Alert>
        </Grid>
      )}

      {consultation.status === "scheduled" && (
        <Grid size={12}>
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              <Button component={Link} href="/agenda">
                {t("consultation-open-agenda")}
              </Button>
            }
          >
            {t("consultation-scheduled-readonly")}
          </Alert>
        </Grid>
      )}

      {consultation.status === "cancelled" && (
        <Grid size={12}>
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("consultation-cancelled-readonly")}
          </Alert>
        </Grid>
      )}

      {!isPrimary && capabilities?.canEditClinicalRecord && (
        <Grid size={12}>
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={takeOver}>{t("consultation-tab-takeover")}</Button>}
          >
            {t("consultation-tab-conflict")}
          </Alert>
        </Grid>
      )}

      {errorKey && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(errorKey)}
          </Alert>
        </Grid>
      )}

      <Grid size={12}>
        <Box className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start">
          <Box className="order-1 flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-1">
            {/* This is the only capture surface and remains first in DOM order
                so mobile visual order and keyboard focus order stay aligned. */}
            {capabilities?.canRecord &&
              (isPrimary ? (
                <ConsultationRecorder
                  orgId={consultation.orgId}
                  patientId={consultation.patientId}
                  consultationId={consultation.id}
                  audioConsent={context?.consents.audio}
                  aiConsent={context?.consents.ai}
                  onRequestConsent={() => setConsentCollectionOpen(true)}
                  onChanged={syncFromServer}
                />
              ) : (
                <Card component="section">
                  <CardContent className="flex flex-col gap-2">
                    <Typography variant="h6" component="h2">
                      {t("recorder-title")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary leading-6">
                      {t("recorder-other-tab")}
                    </Typography>
                    <Button variant="contained" color="primary" onClick={takeOver} className="self-start">
                      {t("recorder-take-over")}
                    </Button>
                  </CardContent>
                </Card>
              ))}

            {canEdit && (
              <RecordingsPanel consultationId={consultation.id} onProcessed={load} refreshSignal={recordingsRefresh} />
            )}
          </Box>

          <Box className="order-2 min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <Card component="section">
              <CardContent className="flex flex-col gap-4">
                <Box>
                  <Typography variant="h5" component="h2" className="card-title">
                    {t("consultation-anamnesis-title")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {captureInFlight
                      ? t("consultation-anamnesis-subtitle-capturing")
                      : t("consultation-anamnesis-subtitle")}
                  </Typography>
                </Box>

                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="consultation-chief-complaint">
                    {t("field-main-complaint")}
                  </FormLabel>
                  <Input
                    id="consultation-chief-complaint"
                    multiline
                    minRows={2}
                    readOnly={isReadOnly}
                    value={headerDraft.chiefComplaint}
                    onChange={(event) => queueHeaderSave("chiefComplaint", event.target.value)}
                    onBlur={() => void saveCoordinator.flush().catch(() => setErrorKey("consultation-save-error"))}
                  />
                </FormControl>

                {ANAMNESIS_BLOCKS.map((block) => (
                  <Accordion
                    key={block.key}
                    elevation={0}
                    disableGutters
                    defaultExpanded={block.key === "complaint"}
                    className="border-grey-100 bg-background-paper rounded-2xl! border"
                  >
                    <AccordionSummary expandIcon={<NiChevronDownSmall />} className="px-5! py-2!">
                      <Typography component="h3" variant="subtitle1">
                        {t(block.title)}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails className="flex flex-col gap-1 px-5! pt-0! pb-5!">
                      {block.fields.map((field) => {
                        const composite = `${block.key}.${field.key}`;
                        const meta = fields[composite];
                        const isObservation = PROFESSIONAL_OBSERVATION_FIELDS.has(composite);
                        return (
                          <FormControl key={field.key} className="outlined" variant="standard" size="small">
                            <FormLabel
                              component="label"
                              htmlFor={`consultation-field-${block.key}-${field.key}`}
                              className="flex flex-row flex-wrap items-center gap-2"
                            >
                              {t(field.label)}
                              {isObservation && (
                                <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-full px-2 py-0.5 text-xs font-semibold">
                                  {t("field-observation-badge")}
                                </span>
                              )}
                              {meta?.value && (
                                <StateChip state={meta.state} sourceLabel={t(`source-${meta.source}`)} t={t} />
                              )}
                              {meta?.provenance?.quote && (
                                <button
                                  type="button"
                                  className="text-secondary-dark dark:text-secondary-light inline-flex items-center gap-1 text-xs font-semibold"
                                  onClick={(event) =>
                                    setProvenanceAnchor({ el: event.currentTarget, data: meta.provenance })
                                  }
                                >
                                  <NiPlay size="tiny" />
                                  {t("field-provenance")}
                                </button>
                              )}
                            </FormLabel>
                            <Input
                              id={`consultation-field-${block.key}-${field.key}`}
                              multiline={field.multiline}
                              minRows={field.multiline ? 2 : undefined}
                              readOnly={isReadOnly}
                              value={meta?.value ?? ""}
                              onChange={(event) => queueAnswerSave(block.key, field.key, event.target.value)}
                              onBlur={() =>
                                void saveCoordinator.flush().catch(() => setErrorKey("consultation-save-error"))
                              }
                            />
                          </FormControl>
                        );
                      })}
                    </AccordionDetails>
                  </Accordion>
                ))}

                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="consultation-summary">
                    {t("consultation-summary")}
                  </FormLabel>
                  <Input
                    id="consultation-summary"
                    multiline
                    minRows={3}
                    readOnly={isReadOnly}
                    value={headerDraft.summary}
                    onChange={(event) => queueHeaderSave("summary", event.target.value)}
                    onBlur={() => void saveCoordinator.flush().catch(() => setErrorKey("consultation-save-error"))}
                  />
                </FormControl>
              </CardContent>
            </Card>
          </Box>

          <Box className="order-3 flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
            {/* Pattern hypotheses (PRD §10.8) — prepared on demand, because a
              pattern is read from the tongue and pulse, and those are HER
              observations, never inferred from the recording (PRD §10.3). */}
            <HypothesesPanel
              consultationId={consultation.id}
              patientId={consultation.patientId}
              reasoningEntitled={Boolean(allowance?.clinicalReasoning)}
              canPrepare={Boolean(canEdit && allowance?.clinicalReasoning)}
              entitlementLoading={allowanceLoading}
              entitlementError={allowanceError}
              onRetryEntitlement={() => void reloadAllowance()}
              isFinalized={isReadOnly}
            />

            {/* Therapeutic plan (PRD §10.9) — built on the accepted hypotheses,
              a draft until she validates it (PRD §10.10). */}
            <PlanPanel
              consultationId={consultation.id}
              canReason={Boolean(canEdit && allowance?.clinicalReasoning)}
              isFinalized={isReadOnly}
            />

            {/* Gaps are suggestions to investigate — never answers (PRD §10.7). */}
            {consultation.aiGaps.length > 0 && canEdit && (
              <Card component="section">
                <CardContent className="flex flex-col gap-2">
                  <Typography variant="h6" component="h2">
                    {t("consultation-gaps-title")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary text-xs">
                    {t("consultation-gaps-subtitle")}
                  </Typography>
                  <Box component="ul" className="flex flex-col gap-1.5">
                    {consultation.aiGaps.map((gap) => (
                      <li key={gap} className="text-text-primary flex items-start gap-2 text-sm leading-5">
                        <span aria-hidden className="bg-accent-3 mt-1.5 h-1.5 w-1.5 flex-none rounded-full" />
                        {gap}
                      </li>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            )}

            <Card component="section">
              <CardContent className="flex flex-col gap-2">
                <Typography variant="h6" component="h2">
                  {t("consultation-state-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary leading-6">
                  {t("consultation-state-body", { count: filledCount })}
                </Typography>
                <Typography variant="body2" className="text-text-secondary leading-6">
                  {t("consultation-absence-note")}
                </Typography>
              </CardContent>
            </Card>

            {addenda.length > 0 && (
              <Card component="section">
                <CardContent className="flex flex-col gap-3">
                  <Typography variant="h6" component="h2">
                    {t("consultation-addenda-title")}
                  </Typography>
                  {addenda.map((addendum) => (
                    <Box key={addendum.id} className="border-grey-100 rounded-2xl border p-3">
                      <Typography variant="body2" className="text-text-primary leading-6">
                        {addendum.body}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary mt-1 text-xs">
                        {new Date(addendum.createdAt).toLocaleString()}
                        {addendum.reason ? ` · ${addendum.reason}` : ""}
                      </Typography>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            )}
          </Box>
        </Box>
      </Grid>

      {/* Provenance: the transcript excerpt an AI value came from (PRD §13.1). */}
      <Popover
        open={Boolean(provenanceAnchor)}
        anchorEl={provenanceAnchor?.el ?? null}
        onClose={() => setProvenanceAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box className="flex max-w-xs flex-col gap-1 p-4">
          <Typography variant="body2" className="text-text-secondary font-mono text-xs">
            {provenanceAnchor?.data.speaker}
            {provenanceAnchor?.data.start ? ` · ${provenanceAnchor.data.start}` : ""}
          </Typography>
          <Typography variant="body2" className="text-text-primary leading-6 italic">
            “{provenanceAnchor?.data.quote}”
          </Typography>
        </Box>
      </Popover>

      {/* Finalizing is irreversible — say so before it happens. */}
      <Dialog open={finalizeOpen} onClose={busy ? undefined : () => setFinalizeOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle className="flex flex-row items-center gap-2">
          <NiCheckSquare size="medium" className="text-primary" />
          {t("consultation-finalize-title")}
        </DialogTitle>
        <DialogContent className="flex flex-col gap-3">
          <Typography variant="body1" className="text-text-secondary leading-6">
            {t("consultation-finalize-body")}
          </Typography>
          <Box className="border-grey-100 rounded-2xl border p-3">
            <Typography variant="subtitle2">{t("consultation-finalize-summary-title")}</Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("consultation-finalize-summary-fields", { filled: filledCount, attention: attentionCount })}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("consultation-finalize-summary-decisions", {
                hypotheses: finalizeSummary.draftHypotheses,
                plans: finalizeSummary.draftPlans,
              })}
            </Typography>
          </Box>
          {finalizeWarnings.length > 0 && (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <Typography variant="body2" className="mb-1 font-semibold">
                {t("consultation-finalize-warnings-title")}
              </Typography>
              {finalizeWarnings.map((warning) => (
                <FormControlLabel
                  key={warning}
                  control={
                    <Checkbox
                      checked={acknowledgedWarnings.includes(warning)}
                      onChange={(event) =>
                        setAcknowledgedWarnings((current) =>
                          event.target.checked
                            ? [...new Set([...current, warning])]
                            : current.filter((item) => item !== warning),
                        )
                      }
                    />
                  }
                  label={t(`consultation-finalize-warning-${warning}`)}
                />
              ))}
            </Alert>
          )}
          {consultationIsEmpty && (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <Typography variant="body2" className="mb-1 font-semibold">
                {t("consultation-finalize-empty-title")}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox checked={emptyConfirmed} onChange={(event) => setEmptyConfirmed(event.target.checked)} />
                }
                label={t("consultation-finalize-empty-confirm")}
              />
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setFinalizeOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={finalize}
            disabled={busy || !allWarningsAcknowledged || (consultationIsEmpty && !emptyConfirmed)}
          >
            {finalizeWarnings.length > 0
              ? t("consultation-finalize-confirm-warnings")
              : t("consultation-finalize-confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addendumOpen} onClose={() => setAddendumOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("consultation-addendum-title")}</DialogTitle>
        <DialogContent className={cn("flex flex-col gap-2")}>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("consultation-addendum-body")}
          </Typography>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label" htmlFor="consultation-addendum-text">
              {t("consultation-addendum-text")}
            </FormLabel>
            <Input
              id="consultation-addendum-text"
              multiline
              minRows={3}
              value={addendumBody}
              onChange={(event) => setAddendumBody(event.target.value)}
            />
          </FormControl>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label" htmlFor="consultation-addendum-reason">
              {t("consultation-addendum-reason")}
            </FormLabel>
            <Input
              id="consultation-addendum-reason"
              value={addendumReason}
              onChange={(event) => setAddendumReason(event.target.value)}
            />
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setAddendumOpen(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={addAddendum} disabled={busy || !addendumBody.trim()}>
            {t("consultation-addendum-save")}
          </Button>
        </DialogActions>
      </Dialog>

      <ConsentCollectionDialog
        open={consentCollectionOpen}
        patientId={consultation.patientId}
        patientName={consultation.patientName}
        consultationId={consultation.id}
        onClose={() => setConsentCollectionOpen(false)}
        onCompleted={load}
      />

      <ScheduleDialog
        open={returnDialogOpen}
        orgId={consultation.orgId}
        timeZone={timezone}
        seed={returnSeed}
        onClose={() => setReturnDialogOpen(false)}
        onSaved={(outcome) => {
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
        }}
      />
    </Grid>
  );
}

/**
 * The per-field review chip: state (clear/attention/edited) + origin. Colors
 * map to the site motif — jade = clear evidence, terracotta = needs attention,
 * neutral = the professional's own edit. Never red (reserved for risk).
 */
function StateChip({ state, sourceLabel, t }: { state: string; sourceLabel: string; t: (key: string) => string }) {
  const style =
    state === "attention"
      ? "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light"
      : state === "edited"
        ? "bg-grey-100 text-text-secondary"
        : "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light";
  const label =
    state === "attention" ? t("state-attention") : state === "edited" ? t("state-edited") : t("state-clear");
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", style)} title={sourceLabel}>
      {label}
    </span>
  );
}
