"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
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
  IconButton,
  Input,
  Popover,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";

import AttachmentsPanel from "@/components/product/attachments-panel";
import ClinicalContextBar from "@/components/product/clinical-context-bar";
import ConsentCollectionDialog from "@/components/product/consent-collection-dialog";
import ConsentSheet, { type ConsentTerm } from "@/components/product/consent-sheet";
import ConsultationAiSummary from "@/components/product/consultation-ai-summary";
import ConsultationRecorder from "@/components/product/consultation-recorder";
import ConsultationStepHeader from "@/components/product/consultation-step-header";
import HypothesesPanel from "@/components/product/hypotheses-panel";
import MobileCaptureHandoff from "@/components/product/mobile-capture-handoff";
import PlanPanel from "@/components/product/plan-panel";
import PrescriptionPanel from "@/components/product/prescription-panel";
import RecordingsPanel from "@/components/product/recordings-panel";
import ScheduleDialog, { type ScheduleSeed } from "@/components/product/schedule-dialog";
import UsageMeter from "@/components/product/usage-meter";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiCross from "@/icons/nexture/ni-cross";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiPlay from "@/icons/nexture/ni-play";
import NiProgress from "@/icons/nexture/ni-progress";
import NiSearch from "@/icons/nexture/ni-search";
import { calendarDateInTimeZone, defaultAppointmentStart, startAppointment, weeklyOccurrences } from "@/lib/agenda";
import { anamnesisBlocksFor, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { recordAudit } from "@/lib/audit";
import { CONSENT_KINDS } from "@/lib/consents";
import {
  ConsultationSaveCoordinator,
  type ConsultationSaveSnapshot,
  NonRetryableSaveError,
  useConsultationTabGuard,
} from "@/lib/consultation-save-coordinator";
import {
  compareAnswer,
  loadPreviousConsultation,
  type PreviousConsultation,
  summarizeChanges,
} from "@/lib/previous-consultation";
import { activeTerms, TCM_VOCABULARY, toggleTerm, type VocabularyGroup } from "@/lib/tcm-vocabulary";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import {
  type ConsultationStatus,
  deriveConsultationCapabilities,
  deriveConsultationJourney,
  deriveConsultationState,
  type Fact,
  factLoading,
  factReady,
  factUnavailable,
  type HypothesisFacts,
  hypothesisFactsFromRows,
  type JourneyFacts,
  type PlanFacts,
  planFactsFromRow,
  type PrescriptionFacts,
  type RecordingStatus,
} from "@flyee/clinical";

type Provenance = {
  quote?: string;
  start?: string;
  speaker?: string;
  transcriptionId?: string;
  /** False when the extraction could not find this quote in the transcript. */
  verified?: boolean;
};
type FieldMeta = {
  value: string;
  state: string;
  source: string;
  provenance: Provenance;
  /** She read this AI draft and kept it as written (confirm_anamnesis_answer, 0098). */
  reviewed?: boolean;
};

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
  aiSummary: string | null;
  /**
   * A record imported from another system (0076): kept whole, never parsed
   * into anamnesis fields, and displayed instead of them.
   */
  legacyBody: string | null;
  legacySource: string | null;
};

type Addendum = { id: string; body: string; reason: string | null; createdAt: string };
type ConsultationContext = {
  /** `fertilityCare`: the cycle/fertility block applies to this patient (0103). */
  patient: { birthDate: string | null; alerts: { label: string }[]; fertilityCare?: boolean };
  consents: { audio: boolean; ai: boolean; images: boolean; aiRefused: boolean; aiNotice: boolean };
  recording: {
    id: string;
    status: RecordingStatus;
    updatedAt: string;
    mode?: "ai" | "audio_only" | null;
    capturedOn?: string | null;
  } | null;
};
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
  const locale = useLocale();
  const { enqueueSnackbar } = useSnackbar();
  const { timezone } = useCurrentOrg();

  // Dates in the clinical record follow the APP's locale and the PRACTICE's
  // timezone — a bare toLocaleDateString() formats in the browser's, which
  // shows the wrong day near midnight and the wrong language to anyone using
  // the app in another locale.
  const dateLabel = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: timezone }).format(
        new Date(iso),
      ),
    [locale, timezone],
  );
  const dateTimeLabel = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(
        new Date(iso),
      ),
    [locale, timezone],
  );

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
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  /** Loose ends the database named when it refused to close the record. */
  const [pendingWarnings, setPendingWarnings] = useState<string[]>([]);
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [consentCollectionOpen, setConsentCollectionOpen] = useState(false);
  /**
   * The in-person consent path, opened from the QR dialog. A patient with no
   * smartphone used to leave the professional either stuck waiting for a scan
   * that would never happen, or navigating out of the open consultation to the
   * patient's consent page and back. The full term is shown and the method is
   * recorded as verbal/in-person, exactly as on that page — a consent record is
   * never a shortcut.
   */
  const [inPersonConsent, setInPersonConsent] = useState<{
    slug: string;
    term: ConsentTerm | null;
    label: string;
    purpose: string;
  } | null>(null);
  /**
   * The consents still missing, collected in ONE sitting. The in-person path
   * used to take a single slug per cycle, so granting audio and AI meant
   * opening the QR dialog, choosing "presencial", signing, and doing the whole
   * thing again — with the patient waiting.
   */
  const [inPersonQueue, setInPersonQueue] = useState<{ slugs: string[]; index: number } | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  /** The other open consultation that blocks starting this one, when the RPC names it. */
  const [startBlockedBy, setStartBlockedBy] = useState<string | null>(null);
  const [addendumBody, setAddendumBody] = useState("");
  const [addendumReason, setAddendumReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [provenanceAnchor, setProvenanceAnchor] = useState<{ el: HTMLElement; data: Provenance } | null>(null);
  const [recordingsRefresh, setRecordingsRefresh] = useState(0);
  /**
   * Was the clinical context READ, or did the fetch fail? The bar and every
   * gate need the difference: a failed read must never be rendered as "no
   * consent" (PRD §10.5), and it must never look like a granted one either.
   */
  const [contextState, setContextState] = useState<"loading" | "ready" | "failed">("loading");
  /**
   * The decisions already on file: hypotheses (by status AND freshness), the
   * plan and the prescription. They drive what each step may offer, so they are
   * read here once instead of being locked inside each panel — and the counts
   * FILTER STALE, which the old `hasAcceptedHypotheses` did not, leaving the
   * plan's AI button lit over a hypothesis the database would refuse.
   */
  const [hypothesisFacts, setHypothesisFacts] = useState<Fact<HypothesisFacts>>(() => factLoading());
  const [planFacts, setPlanFacts] = useState<Fact<PlanFacts | null>>(() => factLoading());
  const [prescriptionFacts, setPrescriptionFacts] = useState<Fact<PrescriptionFacts | null>>(() => factLoading());
  /** Bumped after a save that could have staled the outputs, so the panels re-read at once. */
  const [outputsRefresh, setOutputsRefresh] = useState(0);
  /** "Ouvir este trecho": the excerpt the recordings panel should open on. */
  const [transcriptSeek, setTranscriptSeek] = useState<{
    start: string;
    transcriptionId?: string;
    nonce: number;
  } | null>(null);
  const revisionRef = useRef(0);

  /**
   * The patient timeline links a transcript as `/consultas/<id>#transcription-<id>`
   * and nothing ever read that hash — no element carried the anchor either, so
   * the link landed at the top of the page and looked like a broken feature.
   * The transcript is not an anchor on this page; it is a dialog the recordings
   * panel owns, so honour the hash by ASKING for it.
   */
  useEffect(() => {
    const match = /^#transcription-([0-9a-fA-F-]{36})$/.exec(window.location.hash);
    if (!match) return;
    setTranscriptSeek({ start: "", transcriptionId: match[1], nonce: Date.now() });
  }, []);

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
          "id, org_id, patient_id, status, chief_complaint, summary, started_at, scheduled_for, clinical_revision, ai_gaps, ai_summary, legacy_body, legacy_source, patients(full_name)",
        )
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("anamnesis_answers")
        .select("block_key, field_key, value, state, source, provenance, reviewed_at")
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
      aiSummary: (row.ai_summary as string | null) ?? null,
      legacyBody: (row.legacy_body as string | null) ?? null,
      legacySource: (row.legacy_source as string | null) ?? null,
    };
    revisionRef.current = loadedConsultation.clinicalRevision;
    setConsultation(loadedConsultation);

    const contextBody = (await contextResponse?.json().catch(() => null)) as
      | ({ ok?: boolean } & ConsultationContext)
      | null;
    if (contextResponse?.ok && contextBody?.ok) {
      setContext({ patient: contextBody.patient, consents: contextBody.consents, recording: contextBody.recording });
      setContextState("ready");
      setErrorKey(null);
    } else {
      // Tracked apart from `errorKey`, which any later error overwrites: the
      // gates must keep knowing that consents were never READ, rather than
      // silently treating "could not ask" as "not granted".
      setContextState("failed");
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
        reviewed: Boolean(answer.reviewed_at),
      };
    }
    if (!saveCoordinator.hasUnsavedChanges()) {
      // Never overwrite the field she is typing in. The value is stored
      // TRIMMED, so once the debounce flushed there are no pending changes and
      // the next sync would hand back "paciente relata" over "paciente relata "
      // — the trailing space vanishing mid-sentence, and the next word landing
      // glued to the last one. Pauses of a few seconds are the rule here, not
      // the exception: her attention is on the patient.
      const focused = document.activeElement?.id ?? "";
      const editingField = focused.startsWith("consultation-field-") ? focused : null;
      setFields((current) => {
        if (!editingField) return map;
        const preserved = { ...map };
        for (const [composite, meta] of Object.entries(current)) {
          const [blockKey, fieldKey] = composite.split(".");
          if (`consultation-field-${blockKey}-${fieldKey}` !== editingField) continue;
          if ((meta.value ?? "").trim() === (map[composite]?.value ?? "").trim()) preserved[composite] = meta;
        }
        return preserved;
      });
      const nextHeader = { chiefComplaint: row.chief_complaint ?? "", summary: row.summary ?? "" };
      setHeaderDraft((current) => {
        if (focused !== "consultation-summary" && focused !== "consultation-chief-complaint") return nextHeader;
        return {
          chiefComplaint:
            focused === "consultation-chief-complaint" &&
            current.chiefComplaint.trim() === nextHeader.chiefComplaint.trim()
              ? current.chiefComplaint
              : nextHeader.chiefComplaint,
          summary:
            focused === "consultation-summary" && current.summary.trim() === nextHeader.summary.trim()
              ? current.summary
              : nextHeader.summary,
        };
      });
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

  /**
   * What has already been decided in this consultation: hypotheses by status
   * and freshness, the plan, the prescription. Every step gate reads these, so
   * they are fetched once here — three light queries on the same tick the page
   * already polls — instead of living inside each panel where the others could
   * not see them.
   *
   * A failed query becomes `unavailable`, never an empty count: a gate must be
   * able to say "I could not check" instead of quietly claiming "nothing here".
   */
  const refreshDecisions = useCallback(async () => {
    const consultationId = consultation?.id;
    if (!consultationId || !isSupabaseConfigured) return;
    const supabase = createClient();
    const [hypothesesResult, planResult, prescriptionResult] = await Promise.all([
      supabase.from("consultation_hypotheses").select("status, stale_at").eq("consultation_id", consultationId),
      supabase
        .from("consultation_plans")
        .select("status, origin, stale_at, objective, modalities, safety_flags")
        .eq("consultation_id", consultationId)
        .maybeSingle(),
      supabase.from("consultation_prescriptions").select("status").eq("consultation_id", consultationId).maybeSingle(),
    ]);

    setHypothesisFacts(
      hypothesesResult.error ? factUnavailable() : factReady(hypothesisFactsFromRows(hypothesesResult.data ?? [])),
    );
    setPlanFacts(
      planResult.error ? factUnavailable() : factReady(planResult.data ? planFactsFromRow(planResult.data) : null),
    );
    setPrescriptionFacts(
      prescriptionResult.error
        ? factUnavailable()
        : factReady(
            prescriptionResult.data
              ? { status: prescriptionResult.data.status === "validated" ? "validated" : "draft" }
              : null,
          ),
    );
  }, [consultation?.id]);

  useEffect(() => {
    void refreshDecisions();
  }, [refreshDecisions]);

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
    void refreshDecisions();
    setRecordingsRefresh((value) => value + 1);
  }, [load, refreshDecisions, saveCoordinator]);

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

  // The phone (QR link, mode 'ai') delivers its audio as 'uploaded' — it has
  // no authenticated session to kick the pipeline itself. The moment the sync
  // above sees it, start processing from HERE, so "scan, record, walk back to
  // the computer" ends with the anamnesis drafting itself, no click required.
  // Guarded per recording id; the process route is idempotent anyway (claim
  // returns processing_already_claimed / ready on replays).
  const autoProcessedRef = useRef<string | null>(null);
  useEffect(() => {
    const recording = context?.recording;
    if (!recording || recording.status !== "uploaded") return;
    if (recording.mode !== "ai" || recording.capturedOn !== "qr") return;
    if (autoProcessedRef.current === recording.id) return;
    autoProcessedRef.current = recording.id;
    void fetch(`/api/recordings/${recording.id}/process`, { method: "POST" })
      .then(() => {
        syncFromServer();
        setRecordingsRefresh((value) => value + 1);
      })
      .catch(() => {
        // The recordings panel still offers a manual "process" for this row.
        autoProcessedRef.current = null;
      });
  }, [context?.recording, syncFromServer]);

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
    // A dictated tongue/pulse finding is stored as `professional_voice` even
    // when the MODEL wrote it, so source alone cannot tell drafts apart. The
    // transcript stamp can — it only exists on rows the pipeline wrote.
    const wasAi =
      previous?.source === "ai_inference" ||
      previous?.source === "patient_report" ||
      Boolean(previous?.provenance?.transcriptionId);
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
      const result = data as { ok?: boolean; code?: string; revision?: number; state?: string | null } | null;
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
        // The database is the authority on whether this was an edit of a draft:
        // it can see the transcript stamp on the row we just replaced.
        const persistedState = result.state ?? state;
        return {
          ...current,
          [composite]: { ...current[composite], value: currentValue, source, state: persistedState },
        };
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

  /**
   * "Revisei e mantenho": close a field marked for attention WITHOUT rewriting
   * it (migration 0098).
   *
   * Before this, the only way to clear "requer atenção" was to retype the
   * value, which turns the model's draft into HER text, throws away the
   * provenance, and bumps the clinical revision — staling every hypothesis for
   * the act of agreeing with what was written.
   */
  const confirmAnswer = async (blockKey: string, fieldKey: string) => {
    if (!consultation || !canEdit) return;
    const composite = `${blockKey}.${fieldKey}`;
    const current = fields[composite];
    if (!current) return;
    try {
      // She is confirming what is ON SCREEN, so commit any pending keystroke
      // first: the server compares the value it holds with the one we send.
      await saveCoordinator.flush();
    } catch {
      setErrorKey("consultation-save-error");
      return;
    }
    const { data, error } = await createClient().rpc("confirm_anamnesis_answer", {
      target_consultation: consultation.id,
      target_block_key: blockKey,
      target_field_key: fieldKey,
      expected_value: current.value.trim(),
    });
    const result = data as { ok?: boolean; code?: string; revision?: number } | null;
    if (error || !result?.ok) {
      if (result?.code === "revision_conflict") {
        await load();
        setErrorKey("consultation-revision-conflict");
        return;
      }
      setErrorKey("field-confirm-error");
      return;
    }
    if (Number.isInteger(result.revision)) revisionRef.current = Number(result.revision);
    setFields((currentFields) => {
      const meta = currentFields[composite];
      if (!meta) return currentFields;
      return { ...currentFields, [composite]: { ...meta, state: "clear", reviewed: true } };
    });
  };

  const consultationIsEmpty =
    Object.values(fields).every((meta) => !meta.value.trim()) &&
    !headerDraft.chiefComplaint.trim() &&
    !headerDraft.summary.trim();

  /**
   * Start the scheduled appointment from the record itself. Same RPC the agenda
   * uses; reloading in place is the point — she is standing with the patient,
   * not navigating.
   */
  const beginAppointment = async () => {
    if (!consultation || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await startAppointment(createClient(), consultation.orgId, consultation.id);
      if (!result.ok) {
        // Three different situations used to share one sentence that pointed at
        // the agenda, which fixes none of them.
        setStartBlockedBy(result.code === "active_consultation_exists" ? (result.consultationId ?? null) : null);
        if (result.code === "active_consultation_exists") setErrorKey("consultation-start-active-exists");
        else if (result.code === "patient_unavailable") setErrorKey("consultation-start-patient-unavailable");
        else if (result.code === "stale_status") {
          // It already moved somewhere else: show the current state instead of
          // asking her to try an action that no longer applies.
          await load();
          setErrorKey("consultation-start-stale");
        } else setErrorKey("consultation-start-error");
        return;
      }
      await load();
      router.refresh();
    } catch {
      setErrorKey("consultation-start-error");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Open the in-person sheet for the consent the recorder is missing. Audio
   * comes first: without it there is no capture at all, and the AI consent is
   * only meaningful once audio is allowed.
   */
  /** Open the sheet for one term of the queue (the term text is always shown). */
  const openInPersonConsent = async (slugs: string[], index: number) => {
    const slug = slugs[index];
    const kind = CONSENT_KINDS.find((candidate) => candidate.slug === slug);
    const { data } = await createClient()
      .from("consent_terms")
      .select("id, slug, version, title, body")
      .eq("slug", slug)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    setInPersonQueue({ slugs, index });
    setInPersonConsent({
      slug,
      term: data ?? null,
      label: kind ? t(kind.label) : slug,
      purpose: kind ? t(kind.hint) : "",
    });
  };

  const collectConsentInPerson = async () => {
    if (!consultation) return;
    // Everything still missing, in order, in ONE sitting: audio first (without
    // it there is no capture at all), then the AI processing.
    const missing = [
      ...(context?.consents.audio ? [] : ["audio-recording"]),
      ...(context?.consents.ai ? [] : ["ai-processing"]),
    ];
    const slugs = missing.length > 0 ? missing : ["audio-recording"];
    await openInPersonConsent(slugs, 0);
  };

  const submitConsentInPerson = async (input: { granted: boolean; method: "verbal" | "in_person" }) => {
    if (!inPersonConsent || consentBusy) return;
    setConsentBusy(true);
    try {
      const response = await fetch(`/api/patients/${consultation?.patientId}/consents/${inPersonConsent.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        setErrorKey("consent-save-error");
        return;
      }
      // Straight on to the next term, if there is one: a refusal is a decision
      // too, and the remaining purposes still need an answer.
      const queue = inPersonQueue;
      setInPersonConsent(null);
      await load();
      if (queue && queue.index + 1 < queue.slugs.length) {
        await openInPersonConsent(queue.slugs, queue.index + 1);
      } else {
        setInPersonQueue(null);
      }
    } catch {
      setErrorKey("consent-save-error");
    } finally {
      setConsentBusy(false);
    }
  };

  const prepareFinalize = () => {
    if (!consultation || !capabilities?.canFinalize) return;
    // The dialog opens ALREADY listing what is open — the journey knows the same
    // facts finalize_consultation checks (0093:82-110). She used to discover
    // them only on the second click, after the server refused. The server stays
    // the authority: anything it names that we did not predict is added below
    // and asks for its own confirmation.
    setErrorKey(null);
    setEmptyConfirmed(false);
    setPendingWarnings(journey.finalizeLooseEnds);
    setWarningsConfirmed(false);
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

      const attemptFinalize = async (acknowledged: string[]) => {
        const attempt = await fetch(`/api/consultations/${consultation.id}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: revision, acknowledgedWarnings: acknowledged }),
        });
        return { attempt, payload: (await attempt.json().catch(() => ({}))) as FinalizeResponse };
      };

      // The database refuses to close a record with loose ends and names them:
      // fields marked for attention (medication, pregnancy, anticoagulants),
      // hypotheses or a plan still in draft, an unsigned prescription. This used
      // to tick every one of them and retry immediately, so she never saw any of
      // it — the warning copy existed in five languages with no caller. Now the
      // dialog shows what came back and waits for a deliberate confirmation.
      const acknowledged = [
        ...(consultationIsEmpty && emptyConfirmed ? ["empty_consultation"] : []),
        ...(warningsConfirmed ? pendingWarnings : []),
      ];
      const { attempt: response, payload: body } = await attemptFinalize(acknowledged);
      if (!response.ok && body.error?.code === "finalization_confirmation_required") {
        const returned = Array.isArray(body.error?.details?.warnings)
          ? body.error.details.warnings.filter((warning: unknown): warning is string => typeof warning === "string")
          : [];
        const soft = returned.filter((warning) => warning !== "empty_consultation");
        if (soft.length > 0) {
          setPendingWarnings(soft);
          setWarningsConfirmed(false);
          setBusy(false);
          return;
        }
      }

      if (!response.ok) {
        const code = body.error?.code;
        if (code === "clinical_revision_conflict") {
          await load();
          setErrorKey("consultation-revision-conflict");
        } else {
          setErrorKey(code === "recording_pending" ? "consultation-recording-pending" : "consultation-finalize-error");
        }
        setBusy(false);
        return;
      }

      setFinalizeOpen(false);
      setBusy(false);
      await load();
      router.refresh();
    } catch {
      setErrorKey("consultation-finalize-error");
      setBusy(false);
    }
  };

  /**
   * Issue the attendance certificate and put the PDF in her hands.
   *
   * The document is versioned and QR-verifiable like every other; opening it
   * right away is the point — she is issuing it because someone is asking for
   * it now, usually with the patient still there.
   */
  const issueAttendance = async () => {
    if (!consultation || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/consultations/${consultation.id}/attendance/issue`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        documentId?: string;
        error?: { code?: string };
      };
      if (!response.ok || !body.ok || !body.documentId) {
        // A missing professional name/registration is a field in another screen,
        // not a transient failure — "tente novamente" could never fix it.
        setErrorKey(
          body.error?.code === "document_profile_incomplete"
            ? "attendance-profile-incomplete"
            : "attendance-issue-error",
        );
        return;
      }
      const supabase = createClient();
      const { data: document } = await supabase
        .from("documents")
        .select("storage_path")
        .eq("id", body.documentId)
        .maybeSingle();
      if (document?.storage_path) {
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(document.storage_path, 120);
        if (signed?.signedUrl) window.open(signed.signedUrl, "_blank", "noopener");
      }
    } catch {
      setErrorKey("attendance-issue-error");
    } finally {
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

  /**
   * Clear an investigated "Investigar" suggestion (PRD §10.7). Gaps are AI
   * suggestions, never answers, so removing one changes no clinical value — it
   * turns the list into a checklist she works through, and the card is done
   * once it empties. The RPC returns the new clinical_revision (touching
   * ai_gaps bumps it) so the open editor's autosave stays in sync instead of
   * hitting a phantom conflict on her next keystroke.
   */
  const dismissGap = async (gap: string) => {
    if (!consultation || !canEdit) return;
    // Optimistic: the item leaves the list on click; a failure restores it.
    setConsultation((current) =>
      current ? { ...current, aiGaps: current.aiGaps.filter((existing) => existing !== gap) } : current,
    );
    const supabase = createClient();
    const { data, error } = await supabase.rpc("dismiss_consultation_gap", {
      target_consultation: consultation.id,
      target_gap: gap,
    });
    const result = data as { ok?: boolean; revision?: number; gaps?: string[] } | null;
    if (error || !result?.ok) {
      setErrorKey("consultation-gap-dismiss-error");
      await load();
      return;
    }
    if (Number.isInteger(result.revision)) revisionRef.current = Number(result.revision);
    setConsultation((current) =>
      current ? { ...current, aiGaps: Array.isArray(result.gaps) ? result.gaps : current.aiGaps } : current,
    );
  };

  // Only fields that belong to a CURRENT block count — a chart from before the
  // "plan" block was retired still carries orphan plan.* answers (migration 0031
  // kept the source rows), and counting those would report more filled fields
  // than the total. Chief complaint lives on the consultation row, not among
  // these fields, so it is out of the count too.
  //
  // The blocks are THIS consultation's: the cycle/fertility block (0103) only
  // when it applies — or when it already holds something, so nothing recorded
  // is ever hidden — which also keeps it out of the "X de Y" total for every
  // patient it does not concern.
  const answeredKeys = useMemo(
    () =>
      Object.entries(fields)
        .filter(([, meta]) => meta.value.trim())
        .map(([key]) => key),
    [fields],
  );
  const fertilityCare = context?.patient.fertilityCare === true;
  const blocks = useMemo(() => anamnesisBlocksFor({ fertilityCare }, answeredKeys), [fertilityCare, answeredKeys]);
  const blockFieldKeys = useMemo(
    () => new Set(blocks.flatMap((block) => block.fields.map((field) => `${block.key}.${field.key}`))),
    [blocks],
  );
  const filledCount = useMemo(
    () => Object.entries(fields).filter(([key, meta]) => blockFieldKeys.has(key) && meta.value.trim()).length,
    [fields, blockFieldKeys],
  );
  const totalFieldCount = useMemo(() => blocks.reduce((sum, block) => sum + block.fields.length, 0), [blocks]);
  const attentionCount = useMemo(
    () => Object.entries(fields).filter(([key, meta]) => blockFieldKeys.has(key) && meta.state === "attention").length,
    [fields, blockFieldKeys],
  );

  // What the AI wrote, per block. Without this the drafted anamnesis lands
  // INSIDE collapsed accordions with nothing on their headers: the single
  // moment the product proves its worth happened invisibly, and finding the
  // fields that need her judgement meant opening every block and reading it.
  const blockStats = useMemo(() => {
    const stats: Record<string, { filled: number; attention: number }> = {};
    for (const block of blocks) {
      let filled = 0;
      let attention = 0;
      for (const field of block.fields) {
        const meta = fields[`${block.key}.${field.key}`];
        if (!meta?.value.trim()) continue;
        filled += 1;
        if (meta.state === "attention") attention += 1;
      }
      stats[block.key] = { filled, attention };
    }
    return stats;
  }, [fields, blocks]);

  // Most consultations in this practice are RETURNS, and a return used to start
  // from an empty chart: to recall what she recorded about sleep or pulse she
  // opened the previous consultation in another tab. The values are already in
  // anamnesis_answers under the same stable keys, so showing them beside each
  // field is a lookup — no AI, no consent, no minutes, every plan (PRD §8.3).
  const [previous, setPrevious] = useState<PreviousConsultation | null>(null);
  useEffect(() => {
    if (!consultation || !isSupabaseConfigured) return;
    let cancelled = false;
    void loadPreviousConsultation(createClient(), {
      patientId: consultation.patientId,
      excludeConsultationId: consultation.id,
    }).then((result) => {
      // A failed lookup silently degrades to "no previous consultation": this
      // is context beside the chart, never a reason to block writing it.
      if (!cancelled && result.ok) setPrevious(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [consultation]);

  const changeSummary = useMemo(() => {
    const currentValues: Record<string, string | undefined> = {};
    for (const [key, meta] of Object.entries(fields)) currentValues[key] = meta.value;
    return summarizeChanges(
      currentValues,
      previous,
      blocks.flatMap((block) => block.fields.map((field) => `${block.key}.${field.key}`)),
    );
  }, [fields, previous, blocks]);

  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({ complaint: true });
  const autoExpandedRef = useRef(false);

  // A record waiting for review opens the blocks that actually have something
  // to review — once, so a deliberate collapse is never undone by a poll tick.
  useEffect(() => {
    if (autoExpandedRef.current) return;
    if (consultation?.status !== "awaiting_review") return;
    const withContent = blocks.filter((block) => (blockStats[block.key]?.filled ?? 0) > 0);
    if (withContent.length === 0) return;
    autoExpandedRef.current = true;
    setExpandedBlocks((current) => ({
      ...current,
      ...Object.fromEntries(withContent.map((block) => [block.key, true])),
    }));
  }, [consultation?.status, blockStats, blocks]);

  /**
   * Put ONE field in view, wherever it is. The hypotheses panel names the
   * anamnesis field each sign was read from, but only this screen can expand
   * that block and scroll to it — the prop existed and was never passed, so the
   * chips were inert. The delay lets the panel's dialog finish closing: MUI
   * restores focus to the trigger on close and would take it straight back.
   */
  const focusField = useCallback((blockKey: string, fieldKey: string) => {
    setExpandedBlocks((current) => ({ ...current, [blockKey]: true }));
    window.setTimeout(() => {
      const element = document.getElementById(`consultation-field-${blockKey}-${fieldKey}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
    }, 300);
  }, []);

  /** Jump to the first field the extraction flagged — the review, in one click. */
  const focusFirstAttention = useCallback(() => {
    const target = blocks
      .flatMap((block) => block.fields.map((field) => ({ block, field, meta: fields[`${block.key}.${field.key}`] })))
      .find((entry) => entry.meta?.state === "attention");
    if (!target) return;
    setExpandedBlocks((current) => ({ ...current, [target.block.key]: true }));
    window.setTimeout(() => {
      const element = document.getElementById(`consultation-field-${target.block.key}-${target.field.key}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
    }, 0);
  }, [fields, blocks]);
  /**
   * The journey: one derivation from the record's DATA (`@flyee/clinical`),
   * feeding the bar, the step headers and every disabled button — so the screen
   * and the database stop disagreeing about what she can do right now.
   */
  const recordedAnswerCount = useMemo(
    // What the AI routes count as "something recorded": a non-blank answer that
    // is not rejected, in ANY block (old charts carry answers from retired ones).
    () => Object.values(fields).filter((meta) => meta.value.trim() && meta.state !== "rejected").length,
    [fields],
  );
  const aiDraftPresent = useMemo(
    () =>
      Object.values(fields).some(
        (meta) =>
          meta.source === "ai_inference" ||
          meta.source === "patient_report" ||
          Boolean(meta.provenance?.transcriptionId),
      ),
    [fields],
  );
  const journeyFacts: JourneyFacts = useMemo(
    () => ({
      consultationStatus: consultation?.status ?? "draft",
      recordingStatus,
      isPrimaryTab: isPrimary,
      saveFailed: saveSnapshot.state === "error",
      consents:
        contextState === "ready" && context
          ? factReady({
              audio: context.consents.audio,
              ai: context.consents.ai,
              images: context.consents.images,
              aiRefused: context.consents.aiRefused,
            })
          : contextState === "failed"
            ? factUnavailable()
            : factLoading(),
      reasoningEntitled: allowanceLoading
        ? factLoading()
        : allowanceError
          ? factUnavailable()
          : factReady(Boolean(allowance?.clinicalReasoning)),
      record: {
        recordedAnswerCount,
        hasChiefComplaint: headerDraft.chiefComplaint.trim().length > 0,
        hasSummary: headerDraft.summary.trim().length > 0,
        attentionCount,
        aiDraftPresent,
        tongueRecorded: Boolean(fields["tcm.tongue"]?.value.trim()),
        pulseRecorded: Boolean(fields["tcm.pulse"]?.value.trim()),
        legacyRecord: Boolean(consultation?.legacyBody),
        gapCount: consultation?.aiGaps.length ?? 0,
      },
      hypotheses: hypothesisFacts,
      plan: planFacts,
      prescription: prescriptionFacts,
    }),
    [
      consultation?.status,
      consultation?.legacyBody,
      consultation?.aiGaps.length,
      recordingStatus,
      isPrimary,
      saveSnapshot.state,
      contextState,
      context,
      allowanceLoading,
      allowanceError,
      allowance?.clinicalReasoning,
      recordedAnswerCount,
      headerDraft.chiefComplaint,
      headerDraft.summary,
      attentionCount,
      aiDraftPresent,
      fields,
      hypothesisFacts,
      planFacts,
      prescriptionFacts,
    ],
  );
  const journey = useMemo(() => deriveConsultationJourney(journeyFacts), [journeyFacts]);

  // The cascade, visible within a second instead of at the next 12s poll: a
  // save that bumped the clinical revision has just staled the hypotheses and
  // returned the plan to draft (0031), and she needs to see that while she
  // still remembers editing.
  const previousSaveState = useRef(saveSnapshot.state);
  useEffect(() => {
    const previous = previousSaveState.current;
    previousSaveState.current = saveSnapshot.state;
    if (saveSnapshot.state !== "saved" || previous === "saved") return;
    if (!journey.editingInvalidatesOutputs) return;
    setOutputsRefresh((value) => value + 1);
    void refreshDecisions();
  }, [saveSnapshot.state, journey.editingInvalidatesOutputs, refreshDecisions]);

  /**
   * What the PHONE will be able to do with a QR link, from the same facts it
   * re-checks at capture time. The link is mintable without consent on purpose
   * (0069 — that is what lets a free workspace attach photos), so the QR stays
   * enabled and the dialog says what will work instead of hiding the button.
   */
  const captureCapabilities = useMemo(() => {
    if (contextState !== "ready" || !context) return { audio: "unknown" as const, photos: "unknown" as const };
    const photos = context.consents.images ? ("available" as const) : ("needs_consent" as const);
    if (!context.consents.audio || !context.consents.ai) return { audio: "needs_consent" as const, photos };
    if (allowanceLoading || allowanceError || !allowance) return { audio: "unknown" as const, photos };
    return {
      audio: allowance.canStart || allowance.trialAvailable ? ("available" as const) : ("needs_minutes" as const),
      photos,
    };
  }, [contextState, context, allowance, allowanceLoading, allowanceError]);

  const scrollToStep = useCallback((key: string) => {
    document.getElementById(`etapa-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const nextAction = {
    label: t(`journey-next-${journey.next.key}`, { count: journey.next.count ?? 0 }),
    // One sentence, one control — and the control always exists on this screen.
    action:
      journey.next.key === "review-attention"
        ? { label: t("consultation-review-attention-goto"), onClick: focusFirstAttention }
        : // No action for "consent-for-ai": the consent control sits in this
          // same bar, highlighted while pending — a second button would
          // compete with it.
          journey.next.key === "prepare-hypotheses" ||
            journey.next.key === "decide-hypotheses" ||
            journey.next.key === "hypotheses-stale"
          ? { label: t("journey-next-action-hypotheses"), onClick: () => scrollToStep("hypotheses") }
          : journey.next.key === "plan-stale" || journey.next.key === "validate-plan"
            ? { label: t("journey-next-action-plan"), onClick: () => scrollToStep("plan") }
            : journey.next.key === "record"
              ? { label: t("journey-next-action-record"), onClick: () => scrollToStep("record") }
              : undefined,
  };

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
              <Typography variant="body2">{dateLabel(consultation.startedAt)}</Typography>
            </Breadcrumbs>
          </Box>

          {isFinalized ? (
            <Box className="flex flex-row flex-wrap gap-2">
              {/* The most frequently requested document in a real practice:
                  the note the patient takes to work or school. Only on a
                  FINALIZED record, because it certifies a period that has an
                  end — and it carries no clinical content (PRD §9.8). */}
              <Button variant="outlined" color="grey" onClick={() => void issueAttendance()} disabled={busy}>
                {t("attendance-issue")}
              </Button>
              <Button variant="outlined" color="grey" onClick={() => setAddendumOpen(true)}>
                {t("consultation-add-addendum")}
              </Button>
            </Box>
          ) : null}
        </Box>
      </Grid>

      {/* Pinned only where there is room for it. On a phone the bar is ~280px
          under an 80px fixed header — over half a 667px viewport spent on
          permanent chrome before the keyboard opens, which turned filling the
          anamnesis into typing through a slot. It scrolls with the page there
          and stays pinned from `md` up, where it costs nothing. */}
      <Grid size={12} className="z-20 md:sticky md:top-20">
        <ClinicalContextBar
          patientId={consultation.patientId}
          patientName={consultation.patientName}
          patientBirthDate={context?.patient.birthDate}
          alerts={context?.patient.alerts ?? []}
          scheduledFor={consultation.scheduledFor ?? consultation.startedAt}
          experience={experience}
          consents={context?.consents ?? { audio: false, ai: false, images: false, aiRefused: false }}
          // A missing consent is worth asking for only while the record can change.
          consentActionable={Boolean(capabilities?.canEditClinicalRecord)}
          // A failed context fetch leaves `context` null, and the fallbacks
          // above then read as facts: no alerts, nothing consented. The bar has
          // to know the difference between "nothing there" and "could not ask".
          contextUnavailable={!context && errorKey === "consultation-context-load-error"}
          timezone={timezone}
          saveState={saveSnapshot.state}
          recordingStatus={recordingStatus}
          nextAction={nextAction}
          onRetrySave={() => void saveCoordinator.retry().catch(() => setErrorKey("consultation-save-error"))}
          onManageConsents={() => setConsentCollectionOpen(true)}
          // Finalizing no longer DISAPPEARS while a recording is processing: it
          // stays, disabled, with the reason under it. The button vanishing while
          // the bar still said "finalize quando estiver de acordo" is exactly how
          // this screen sent her looking for a control that was not there.
          primaryAction={
            journey.gates.finalize.state === "hidden"
              ? undefined
              : {
                  label: t("consultation-review-finalize"),
                  count: journey.finalizeLooseEnds.length,
                  ariaLabel:
                    journey.finalizeLooseEnds.length > 0
                      ? t("consultation-review-finalize-count", { count: journey.finalizeLooseEnds.length })
                      : undefined,
                  onClick: prepareFinalize,
                  disabled: busy || journey.gates.finalize.state !== "available",
                  variant: consultationIsEmpty && consultation.status !== "awaiting_review" ? "outlined" : "contained",
                  reason:
                    journey.gates.finalize.state === "blocked"
                      ? t(`journey-reason-${journey.gates.finalize.reason}`)
                      : undefined,
                }
          }
        />
      </Grid>

      {/* An AI-drafted consultation says so, and points review at the exceptions. */}
      {consultation.status === "awaiting_review" && (
        <Grid size={12}>
          <Alert
            severity="info"
            icon={<NiListCheck />}
            className="neutral bg-background-paper/60!"
            action={
              attentionCount > 0 ? (
                <Button color="inherit" size="small" onClick={focusFirstAttention}>
                  {t("consultation-review-attention-goto")}
                </Button>
              ) : undefined
            }
          >
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
            // Starting the appointment used to live ONLY in the agenda, so
            // arriving here from the patient's timeline or a direct link meant
            // leaving the screen, finding the slot, pressing "Começar" and
            // coming back — three navigations for the most frequent action of
            // the day, with the patient already on the table.
            action={
              capabilities?.canStart ? (
                <Button variant="contained" color="primary" onClick={() => void beginAppointment()} disabled={busy}>
                  {t("consultation-start-appointment")}
                </Button>
              ) : (
                <Button component={Link} href="/agenda">
                  {t("consultation-open-agenda")}
                </Button>
              )
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
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            // "Recarregue antes de continuar" without a way to reload is an
            // instruction, not a recovery. The load is right here.
            // Each cause gets the control that resolves IT: reloading the
            // context, opening the consultation that is in the way, restoring
            // the patient, or filling in the professional profile.
            action={
              errorKey === "consultation-context-load-error" ? (
                <Button onClick={() => void load()}>{t("retry")}</Button>
              ) : errorKey === "consultation-start-active-exists" && startBlockedBy ? (
                <Button component={Link} href={`/consultas/${startBlockedBy}`}>
                  {t("consultation-start-open-active")}
                </Button>
              ) : errorKey === "consultation-start-patient-unavailable" ? (
                <Button component={Link} href={`/pacientes/${consultation.patientId}`}>
                  {t("consultation-open-patient")}
                </Button>
              ) : errorKey === "attendance-profile-incomplete" ? (
                <Button component={Link} href="/settings" target="_blank" rel="noopener">
                  {t("attendance-open-profile")}
                </Button>
              ) : undefined
            }
          >
            {t(errorKey)}
          </Alert>
        </Grid>
      )}

      <Grid size={12}>
        <Box className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start">
          {/* On desktop the assistant column scrolls INSIDE itself and sticks:
              its tools (hypotheses, plan) can grow far taller than the chart,
              and letting them stretch the page forced scrolling past everything
              to reach what is below. On mobile it stays a normal stacked block. */}
          {/* [&>*]:shrink-0 is load-bearing, not cosmetic: a MUI Card sets
              overflow:hidden, and per the flexbox spec an item whose overflow
              is not visible has an automatic minimum size of ZERO. So once
              this column hits its max-height, flexbox SHRANK the cards instead
              of scrolling and each one silently clipped its own footer (the
              recorder lost its last button). Refusing to shrink is what makes
              overflow-y-auto actually scroll. */}
          {/* The capture column is capped SHORT of the viewport on purpose. At
              100vh it filled the screen by itself, and the tools column below it
              (steps 2 and 3 of the same numbered sequence — Hipóteses, Plano)
              began a full scroll down, so the guided flow ended where the fold
              was. Capped, the next step is visible from the top of the page. */}
          {/* A read-only record (cancelled/scheduled) has no capture surface —
              render NOTHING rather than an empty column, which left a large
              blank at the top of the tools column. A FINALIZED one is
              different: it has no capture surface either, but it does have the
              evidence. The transcript is what every AI-filled field points back
              to (PRD §13.1), and it used to disappear at exactly the moment
              review, audit or a challenge would need it. */}
          {(capabilities?.canEditClinicalRecord || isFinalized) && (
            <Box className="order-1 flex min-w-0 flex-col gap-5 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:max-h-[68vh] lg:overflow-y-auto lg:pr-1 lg:[&>*]:shrink-0">
              {/* This is the only capture surface and remains first in DOM order
                so mobile visual order and keyboard focus order stay aligned.
                Mount on canEditClinicalRecord, NOT canRecord: canRecord means
                "may START a new recording" and flips false the instant a
                capture begins (status → recording is a blocking op). Gating the
                mount on it would UNMOUNT the recorder mid-capture — its cleanup
                stops the mic and the take drops to ~1s. Editability is stable
                across the whole record → upload → process lifecycle. */}
              {capabilities?.canEditClinicalRecord &&
                (isPrimary ? (
                  <ConsultationRecorder
                    orgId={consultation.orgId}
                    patientId={consultation.patientId}
                    consultationId={consultation.id}
                    audioConsent={context?.consents.audio}
                    aiConsent={context?.consents.ai}
                    onRequestConsent={() => setConsentCollectionOpen(true)}
                    onChanged={syncFromServer}
                    // Phone-via-QR is an alternate METHOD for this same step, not
                    // a step of its own — it renders inside the recorder's own
                    // card instead of a second, confusingly-numbered "step 1".
                    secondaryCapture={
                      <MobileCaptureHandoff consultationId={consultation.id} capabilities={captureCapabilities} />
                    }
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

              {/* Read-only once the record is closed: the transcript and its
                  audio stay readable, while processing and discarding — which
                  would change a frozen record — do not. */}
              {(canEdit || isFinalized) && (
                <RecordingsPanel
                  consultationId={consultation.id}
                  onProcessed={load}
                  refreshSignal={recordingsRefresh}
                  seekTo={transcriptSeek ?? undefined}
                  readOnly={isFinalized}
                />
              )}

              {/* Documents and photos attached to the record (exam PDFs, clinical
                photos) — uploaded here or captured on the phone via the QR. */}
              {capabilities?.canEditClinicalRecord && isPrimary && (
                <AttachmentsPanel
                  consultationId={consultation.id}
                  canAnalyze={Boolean(allowance?.clinicalReasoning)}
                  analyzeGate={journey.gates.analyzeAttachment}
                  refreshSignal={recordingsRefresh}
                />
              )}
            </Box>
          )}

          <Box
            id="etapa-record"
            className="order-2 flex min-w-0 scroll-mt-4 flex-col gap-5 md:scroll-mt-60 lg:col-start-1 lg:row-span-2 lg:row-start-1"
          >
            {/* Intro card: what the anamnesis is, plus the return-visit context.
                Each anamnesis block below is its OWN card so the sections read as
                distinct areas of the chart instead of blurring together. */}
            <Card component="section">
              <CardContent className="flex flex-col gap-4">
                {/* The chart IS the step: recording is one way of filling it,
                    typing is the other, and both finish it. Numbering only the
                    recorder made the manual path read as outside the flow. */}
                <ConsultationStepHeader
                  step={journey.steps.record.number}
                  icon={<NiDocumentFull size="medium" />}
                  title={t("consultation-anamnesis-title")}
                  hint={
                    captureInFlight
                      ? t("consultation-anamnesis-subtitle-capturing")
                      : t("consultation-anamnesis-subtitle")
                  }
                  status={
                    journey.steps.record.state === "done"
                      ? "done"
                      : journey.steps.record.state === "in_progress"
                        ? "in_progress"
                        : undefined
                  }
                  statusLabel={
                    journey.steps.record.state === "done"
                      ? t("journey-step-done")
                      : journey.steps.record.state === "in_progress"
                        ? t("journey-step-in-progress")
                        : undefined
                  }
                />

                {/* What editing will COST, before she edits: any change to the
                    chart stales the hypotheses and returns the plan to draft
                    (0031). Learning that afterwards is what made the screen feel
                    like it was undoing her work. */}
                {canEdit && journey.editingInvalidatesOutputs && (
                  <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                    {t("journey-outputs-cost-hint")}
                  </Typography>
                )}

                {/* The one line that names the case. It drives the patient
                    timeline and every AI prompt, and it had become unwritable:
                    the header editor was removed as a duplicate of the block
                    below, and the extraction catalog excludes it by design — so
                    `chief_complaint` was null for every consultation and each
                    reader silently degraded. One short field, not the block. */}
                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="consultation-chief-complaint">
                    {t("consultation-chief-complaint")}
                  </FormLabel>
                  <Input
                    id="consultation-chief-complaint"
                    multiline
                    minRows={2}
                    maxRows={8}
                    value={headerDraft.chiefComplaint}
                    placeholder={t("consultation-chief-complaint-placeholder")}
                    readOnly={isReadOnly}
                    onChange={(event) => queueHeaderSave("chiefComplaint", event.target.value)}
                    onBlur={() => void saveCoordinator.flush().catch(() => setErrorKey("consultation-save-error"))}
                  />
                </FormControl>

                {/* A RETURN answers a different question than a first visit:
                    "what changed?". Stated once here, and per field below, so
                    continuity of care is visible instead of buried in the
                    previous consultation (PRD §8.3). Purely derived from what
                    she validated last time — no AI, every plan. */}
                {/* An IMPORTED last consultation has no answers to compare, so
                    the field-by-field view would show nothing and promise values
                    that never appear. Its original text is the history she has:
                    the most recent imported records, as written there. */}
                {previous && previous.importedHistory.length > 0 && (
                  <Box className="bg-grey-100/60 flex flex-col gap-2 rounded-2xl px-4 py-3">
                    <Box className="flex flex-col gap-0.5">
                      <Typography variant="body2" className="text-text-primary text-xs leading-5 font-semibold">
                        {t("previous-consultation-title", { date: dateLabel(previous.when) })}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                        {t("previous-consultation-imported-note")}
                      </Typography>
                    </Box>
                    <Box
                      component="ul"
                      aria-label={t("previous-consultation-imported-list")}
                      className="m-0 flex list-none flex-col gap-1.5 p-0"
                    >
                      {previous.importedHistory.map((record) => (
                        <Box component="li" key={record.id}>
                          <Link
                            href={`/consultas/${record.id}`}
                            className="bg-background-paper hover:bg-background-paper/70 flex flex-col gap-0.5 rounded-xl px-3 py-2 no-underline"
                          >
                            <span className="text-text-secondary text-xs leading-5 tabular-nums">
                              {dateLabel(record.when)}
                            </span>
                            <span className="text-text-primary line-clamp-3 text-sm leading-5 whitespace-pre-wrap">
                              {record.excerpt}
                            </span>
                          </Link>
                        </Box>
                      ))}
                    </Box>
                    <Link
                      href={`/pacientes/${consultation.patientId}`}
                      className="text-secondary-dark dark:text-secondary-light text-xs font-semibold"
                    >
                      {t("previous-consultation-imported-all")}
                    </Link>
                  </Box>
                )}
                {previous && previous.importedHistory.length === 0 && (
                  <Box className="bg-grey-100/60 flex flex-col gap-1 rounded-2xl px-4 py-3">
                    <Typography variant="body2" className="text-text-primary text-xs leading-5 font-semibold">
                      {t("previous-consultation-title", { date: dateLabel(previous.when) })}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                      {changeSummary.changed + changeSummary.new + changeSummary.missing === 0
                        ? t("previous-consultation-no-changes")
                        : t("previous-consultation-changes", {
                            changed: changeSummary.changed,
                            added: changeSummary.new,
                            pending: changeSummary.missing,
                          })}
                    </Typography>
                    {previous.patterns.length > 0 && (
                      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                        {t("previous-consultation-patterns", { patterns: previous.patterns.join(" · ") })}
                      </Typography>
                    )}
                    <Link
                      href={`/consultas/${previous.id}`}
                      className="text-secondary-dark dark:text-secondary-light text-xs font-semibold"
                    >
                      {t("previous-consultation-open")}
                    </Link>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* A record from another system is shown as what it is — the text
                as it was written, labelled with its origin — and REPLACES the
                anamnesis blocks. Rendering forty empty fields next to it would
                read as "not informed" about a consultation nobody documented
                here, and splitting the text into those fields is exactly what
                this feature refuses to do (docs/IMPORT-EXPORT.md §0). */}
            {consultation.legacyBody ? (
              <Card component="section">
                <CardContent className="flex flex-col gap-3">
                  <Box className="flex flex-col gap-1">
                    <Typography variant="h5" component="h2" className="card-title mb-0">
                      {t("legacy-record-title")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {consultation.legacySource
                        ? t("legacy-record-from", { source: consultation.legacySource })
                        : t("legacy-record-unknown-source")}
                    </Typography>
                  </Box>
                  <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
                    {consultation.legacyBody}
                  </Typography>
                  <Alert severity="info">{t("legacy-record-note")}</Alert>
                </CardContent>
              </Card>
            ) : (
              blocks.map((block) => {
                const expanded = expandedBlocks[block.key] ?? false;
                return (
                  <Card key={block.key} component="section">
                    <CardContent className="flex flex-col gap-1">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        className="flex w-full flex-row flex-wrap items-center gap-2 text-left"
                        onClick={() => setExpandedBlocks((current) => ({ ...current, [block.key]: !expanded }))}
                      >
                        <Typography component="h3" variant="subtitle1" className="mb-0">
                          {t(block.title)}
                        </Typography>
                        {(blockStats[block.key]?.filled ?? 0) > 0 && (
                          <span className="bg-grey-100 text-text-secondary rounded-full px-2 py-0.5 text-xs font-semibold">
                            {t("block-filled-count", { count: blockStats[block.key].filled })}
                          </span>
                        )}
                        {(blockStats[block.key]?.attention ?? 0) > 0 && (
                          <span className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light rounded-full px-2 py-0.5 text-xs font-semibold">
                            {t("block-attention-count", { count: blockStats[block.key].attention })}
                          </span>
                        )}
                        <NiChevronDownSmall
                          aria-hidden
                          className={cn("text-text-secondary ml-auto transition-transform", expanded && "rotate-180")}
                        />
                      </button>
                      {expanded && (
                        <Box className="flex flex-col gap-1 pt-1">
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
                                    <StateChip
                                      state={meta.state}
                                      reviewed={Boolean(meta.reviewed)}
                                      sourceLabel={t(`source-${meta.source}`)}
                                      t={t}
                                    />
                                  )}
                                </FormLabel>
                                {/* Moved OUT of the field label above. A button
                                    nested inside a label bound to this input is
                                    invalid markup, it inflates the field's
                                    accessible name with every badge and chip,
                                    and pressing it also focuses the input. On
                                    its own row it finally gets a real touch
                                    target — this is the control that answers
                                    "where did this value come from?". */}
                                <Box className="flex flex-row flex-wrap items-center gap-2">
                                  {meta?.provenance?.quote && (
                                    <button
                                      type="button"
                                      className="text-secondary-dark dark:text-secondary-light -mt-0.5 mb-0.5 inline-flex min-h-9 items-center gap-1 self-start px-1 text-xs font-semibold"
                                      onClick={(event) =>
                                        setProvenanceAnchor({ el: event.currentTarget, data: meta.provenance })
                                      }
                                    >
                                      <NiPlay size="tiny" />
                                      {t("field-provenance")}
                                    </button>
                                  )}
                                  {/* The exit from "requer atenção" when the
                                      value is RIGHT. Rewriting the text was the
                                      only way out before — and it turned the
                                      model's draft into her own words, dropped
                                      the provenance and staled the hypotheses. */}
                                  {canEdit && meta?.state === "attention" && (
                                    <button
                                      type="button"
                                      className="text-secondary-dark dark:text-secondary-light -mt-0.5 mb-0.5 inline-flex min-h-9 items-center gap-1 self-start px-1 text-xs font-semibold"
                                      aria-label={t("field-confirm-keep-label", { field: t(field.label) })}
                                      onClick={() => void confirmAnswer(block.key, field.key)}
                                    >
                                      {t("field-confirm-keep")}
                                    </button>
                                  )}
                                </Box>
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
                                {/* Tongue and pulse are dictated with a patient on
                                  the table and their vocabulary is finite and
                                  consecrated — tapping beats typing, and the
                                  text stays free-form either way. */}
                                {canEdit && TCM_VOCABULARY[composite] && (
                                  <VocabularyChips
                                    groups={TCM_VOCABULARY[composite]}
                                    value={meta?.value ?? ""}
                                    onToggle={(next) => {
                                      queueAnswerSave(block.key, field.key, next);
                                      void saveCoordinator.flush().catch(() => setErrorKey("consultation-save-error"));
                                    }}
                                    t={t}
                                  />
                                )}
                                <PreviousFieldValue
                                  previousValue={previous?.answers[composite]?.value}
                                  currentValue={meta?.value}
                                  canEdit={canEdit}
                                  onKeep={(value) => {
                                    queueAnswerSave(block.key, field.key, value);
                                    void saveCoordinator.flush().catch(() => setErrorKey("consultation-save-error"));
                                  }}
                                  t={t}
                                />
                              </FormControl>
                            );
                          })}
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}

            {/* Clinical summary — her free-text close, with the AI-suggested
                draft she can copy into it. Its own card, separate from the
                anamnesis blocks. */}
            <Card component="section">
              <CardContent className="flex flex-col gap-4">
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

                {/* AI-suggested summary (PRD §10 draft discipline): a separate
                    draft she reviews and copies in — it never writes her summary
                    on its own. Generated once at finalization over all
                    recordings, and refreshable on demand while editable. */}
                <ConsultationAiSummary
                  consultationId={consultation.id}
                  canGenerate={Boolean(allowance?.clinicalReasoning)}
                  gate={journey.gates.generateSummary}
                  initialSummary={consultation.aiSummary}
                  onApply={(text) => queueHeaderSave("summary", text)}
                  invalidatesOutputs={journey.editingInvalidatesOutputs}
                  readOnly={isReadOnly}
                />
              </CardContent>
            </Card>
          </Box>

          {/* With no capture column, the tools rise to row 1 so they sit beside
              the chart instead of leaving the top-right blank (see order-1). */}
          <Box
            className={cn(
              "order-3 flex min-w-0 flex-col gap-5 lg:col-start-2",
              capabilities?.canEditClinicalRecord ? "lg:row-start-2" : "lg:row-start-1",
            )}
          >
            {/* Gaps are suggestions to investigate — never answers (PRD §10.7). */}
            {consultation.aiGaps.length > 0 && canEdit && (
              <Card component="section">
                <CardContent className="flex flex-col gap-2">
                  <Box className="flex flex-row items-center gap-2">
                    <span
                      aria-hidden
                      className="bg-accent-3/10 text-accent-3 flex h-9 w-9 flex-none items-center justify-center rounded-xl"
                    >
                      <NiSearch size="small" />
                    </span>
                    <Typography variant="h6" component="h2" className="mb-0">
                      {t("consultation-gaps-title")}
                    </Typography>
                  </Box>
                  <Typography variant="body2" className="text-text-secondary text-xs">
                    {t("consultation-gaps-subtitle")}
                  </Typography>
                  {/* Actionable, not just informative: each suggestion is an open
                      loop she can close. Dismissing one (she investigated it, or
                      it does not apply) removes it — the list shrinks and the
                      card is done once empty. The control DISMISSES the question;
                      it never affirms the finding (a gap is a question, never an
                      answer — PRD §10.7), which is why it is a "remove", not a
                      checkmark. */}
                  <Box component="ul" className="flex flex-col gap-1.5">
                    {consultation.aiGaps.map((gap) => (
                      <Box
                        component="li"
                        key={gap}
                        className="border-grey-100 flex flex-row items-start gap-2 rounded-2xl border px-3 py-2"
                      >
                        <span aria-hidden className="bg-accent-3 mt-2 h-1.5 w-1.5 flex-none rounded-full" />
                        <Typography variant="body2" className="text-text-primary flex-1 text-sm leading-5">
                          {gap}
                        </Typography>
                        <Tooltip title={t("consultation-gaps-dismiss")}>
                          <IconButton
                            size="small"
                            aria-label={t("consultation-gaps-dismiss")}
                            onClick={() => void dismissGap(gap)}
                            className="text-text-secondary hover:text-primary -my-0.5 -mr-1 flex-none"
                          >
                            <NiCross size="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            )}

            {/* Pattern hypotheses (PRD §10.8) — prepared on demand, because a
              pattern is read from the tongue and pulse, and those are HER
              observations, never inferred from the recording (PRD §10.3). */}
            <Box id="etapa-hypotheses" className="scroll-mt-4 md:scroll-mt-60">
              <HypothesesPanel
                consultationId={consultation.id}
                patientId={consultation.patientId}
                reasoningEntitled={Boolean(allowance?.clinicalReasoning)}
                // Gated by the FACTS the route checks, not by status alone.
                prepareGate={journey.gates.prepareHypotheses}
                stepNumber={journey.steps.hypotheses.number}
                entitlementLoading={allowanceLoading}
                entitlementError={allowanceError}
                onRetryEntitlement={() => void reloadAllowance()}
                onDecisionChanged={() => void refreshDecisions()}
                refreshSignal={outputsRefresh}
                onFocusField={focusField}
                onBeforePrepare={async () => {
                  await saveCoordinator.flush();
                }}
                isFinalized={isReadOnly}
              />
            </Box>

            {/* Therapeutic plan (PRD §10.9) — built on the accepted hypotheses,
              a draft until she validates it (PRD §10.10). */}
            <Box id="etapa-plan" className="scroll-mt-4 md:scroll-mt-60">
              <PlanPanel
                consultationId={consultation.id}
                prepareGate={journey.gates.preparePlanAi}
                createManualGate={journey.gates.createManualPlan}
                stepNumber={journey.steps.plan.number}
                consultationStatus={consultation.status}
                onChanged={() => void refreshDecisions()}
                refreshSignal={outputsRefresh}
                isFinalized={isReadOnly}
              />
            </Box>

            {/* Receituário (PRD §9.8) — the professional's own prescription
              (herbal formula / generic). Authored by her, never the AI; a draft
              until she validates and signs it. */}
            <PrescriptionPanel
              consultationId={consultation.id}
              orgId={consultation.orgId}
              isFinalized={isReadOnly}
              onChanged={() => void refreshDecisions()}
            />

            <Card component="section">
              <CardContent className="flex flex-col gap-3">
                <Box className="flex flex-row items-center gap-2">
                  <span
                    aria-hidden
                    className="bg-primary/10 text-primary flex h-9 w-9 flex-none items-center justify-center rounded-xl"
                  >
                    <NiProgress size="small" />
                  </span>
                  <Typography variant="h6" component="h2" className="mb-0">
                    {t("consultation-state-title")}
                  </Typography>
                </Box>
                {/* A completion readout, not a score: blank fields are "não
                    informado", never a deficiency — grey, not amber/red. */}
                <UsageMeter
                  ariaLabel={t("consultation-state-title")}
                  headline={t("consultation-state-body", { count: filledCount })}
                  caption={t("consultation-absence-note")}
                  segments={[
                    {
                      key: "filled",
                      label: t("consultation-state-filled"),
                      value: filledCount,
                      display: String(filledCount),
                      tone: "primary",
                    },
                    {
                      key: "remaining",
                      label: t("consultation-state-remaining"),
                      value: Math.max(0, totalFieldCount - filledCount),
                      display: String(Math.max(0, totalFieldCount - filledCount)),
                      tone: "empty",
                    },
                  ]}
                />
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
                        {dateTimeLabel(addendum.createdAt)}
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
        <Box className="flex max-w-xs flex-col gap-2 p-4">
          <Typography variant="body2" className="text-text-secondary font-mono text-xs">
            {provenanceAnchor?.data.speaker}
            {provenanceAnchor?.data.start ? ` · ${provenanceAnchor.data.start}` : ""}
          </Typography>
          <Typography variant="body2" className="text-text-primary leading-6 italic">
            “{provenanceAnchor?.data.quote}”
          </Typography>
          {/* A quote the pipeline could not locate in the transcript is shown
              WITH that fact. Evidence that cannot be checked is not evidence,
              and hiding the doubt would be the dishonest half of the feature. */}
          {provenanceAnchor?.data.verified === false && (
            <Typography variant="body2" className="text-accent-3-dark dark:text-accent-3-light text-xs leading-5">
              {t("field-provenance-unverified")}
            </Typography>
          )}
          {/* Only offered while the recordings panel is on screen — it owns the
              transcript dialog, so without it this button would go nowhere. */}
          {canEdit && provenanceAnchor?.data.start && (
            <Button
              variant="text"
              size="small"
              className="self-start"
              startIcon={<NiPlay size="tiny" />}
              onClick={() => {
                const data = provenanceAnchor?.data;
                setProvenanceAnchor(null);
                if (data?.start) {
                  setTranscriptSeek({
                    start: data.start,
                    transcriptionId: data.transcriptionId,
                    nonce: Date.now(),
                  });
                }
              }}
            >
              {t("field-provenance-listen")}
            </Button>
          )}
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
          {/* A plain readout: how much of the chart is filled, out of the total.
              Blank fields are "não informado", never a deficiency (PRD §10.5),
              so this is a fraction — not an attention/draft to-do list. */}
          <Box className="border-grey-100 rounded-2xl border p-3">
            <Typography variant="subtitle2">{t("consultation-finalize-summary-title")}</Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("consultation-finalize-summary-fields", { filled: filledCount, total: totalFieldCount })}
            </Typography>
          </Box>
          {/* What the record still has open. Closing freezes all of it, and an
              unsigned prescription in particular can never be signed from
              scratch afterwards — so this is the last moment it can be said. */}
          {pendingWarnings.length > 0 && (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <Typography variant="body2" className="mb-1 font-semibold">
                {t("consultation-finalize-warnings-title")}
              </Typography>
              <Box component="ul" className="mb-1 list-disc pl-5">
                {pendingWarnings.map((warning) => (
                  <Typography key={warning} component="li" variant="body2" className="text-text-secondary">
                    {t(`consultation-finalize-warning-${warning}`)}
                    {/* The one loose end she can close from here in one move. */}
                    {warning === "attention_fields" && attentionCount > 0 && (
                      <Button
                        size="small"
                        className="ml-1 px-1!"
                        onClick={() => {
                          setFinalizeOpen(false);
                          focusFirstAttention();
                        }}
                      >
                        {t("consultation-review-attention-goto")}
                      </Button>
                    )}
                  </Typography>
                ))}
              </Box>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={warningsConfirmed}
                    onChange={(event) => setWarningsConfirmed(event.target.checked)}
                  />
                }
                label={t("consultation-finalize-warnings-confirm")}
              />
            </Alert>
          )}
          {/* Closing runs the suggested summary first and can take most of a
              minute. Saying so beats a silent dialog that looks stuck with the
              next patient already at the door. */}
          {busy && (
            <Typography variant="body2" role="status" className="text-text-secondary text-xs leading-5">
              {t(allowance?.clinicalReasoning ? "consultation-finalize-busy" : "consultation-finalize-busy-basic")}
            </Typography>
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
            disabled={
              busy || (consultationIsEmpty && !emptyConfirmed) || (pendingWarnings.length > 0 && !warningsConfirmed)
            }
          >
            {t("consultation-finalize-confirm")}
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
        onCollectInPerson={() => void collectConsentInPerson()}
      />

      {/* The in-person path, with the full term on screen and the method
          recorded — a consent record is never a shortcut, even with the patient
          sitting right there. */}
      {inPersonConsent && (
        <ConsentSheet
          open
          label={inPersonConsent.label}
          progress={
            inPersonQueue && inPersonQueue.slugs.length > 1
              ? t("consent-sequence", { current: inPersonQueue.index + 1, total: inPersonQueue.slugs.length })
              : undefined
          }
          purpose={inPersonConsent.purpose}
          term={inPersonConsent.term}
          active={false}
          busy={consentBusy}
          onClose={() => setInPersonConsent(null)}
          onSubmit={submitConsentInPerson}
        />
      )}

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
/**
 * Quick-entry vocabulary for tongue, pulse and palpation (PRD §9.6).
 *
 * These fields are dictated during the appointment, and their terms are a
 * closed, consecrated set — so tapping composes the same sentence she would
 * have typed, in a fraction of the time. The chips ADD TO the free text and
 * never replace it: anything she writes by hand survives, and a term typed
 * inside a longer phrase is left alone rather than rewritten.
 *
 * Rendered only while the record is editable — on a finalized consultation
 * they would offer an action the database would refuse (PRD §8.5).
 */
function VocabularyChips({
  groups,
  value,
  onToggle,
  t,
}: {
  groups: VocabularyGroup[];
  value: string;
  onToggle: (next: string) => void;
  t: (key: string) => string;
}) {
  const active = activeTerms(value, groups);
  return (
    <Box className="mt-1.5 flex flex-col gap-1.5">
      {groups.map((group) => (
        <Box key={group.label} className="flex flex-row flex-wrap items-center gap-1.5">
          <Typography variant="body2" className="text-text-secondary mr-1 text-xs leading-5">
            {t(group.label)}
          </Typography>
          {group.terms.map((term) => {
            const selected = active.has(term);
            return (
              <button
                key={term}
                type="button"
                aria-pressed={selected}
                className={cn(
                  // These exist because tongue and pulse are dictated with the
                  // patient on the table and tapping beats typing — which only
                  // holds if the tap lands. At ~22px with 4px between them,
                  // hitting the neighbour writes the wrong clinical term and
                  // autosave persists it immediately.
                  "min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary/12 text-primary font-semibold"
                    : "border-grey-100 text-text-secondary hover:border-primary/40",
                )}
                onClick={() => onToggle(toggleTerm(value, term))}
              >
                {term}
              </button>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

/**
 * What she recorded for this same field last time (PRD §8.3).
 *
 * Shown UNDER the input, muted, never pre-filling it: the previous
 * consultation is context for this one, not an answer to it — copying it
 * forward silently would put words in the patient's mouth. "Manter igual" is
 * the one click that does copy it, and it flows through the normal save path
 * so the value becomes hers (source professional), exactly as if she had typed
 * it. Nothing renders when the field matches or there is nothing to compare,
 * so a return consultation shows only what actually differs.
 */
function PreviousFieldValue({
  previousValue,
  currentValue,
  canEdit,
  onKeep,
  t,
}: {
  previousValue?: string;
  currentValue?: string;
  canEdit: boolean;
  onKeep: (value: string) => void;
  t: (key: string) => string;
}) {
  const previous = (previousValue ?? "").trim();
  if (!previous) return null;
  const change = compareAnswer(currentValue, previous);
  if (change === "same") return null;

  return (
    <Box className="mt-1 flex flex-row flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
        <span className="font-semibold">{t("previous-field-label")}</span> {previous}
      </Typography>
      {canEdit && change === "missing" && (
        <button
          type="button"
          className="text-secondary-dark dark:text-secondary-light min-h-9 px-1 text-xs font-semibold"
          onClick={() => onKeep(previous)}
        >
          {t("previous-field-keep")}
        </button>
      )}
    </Box>
  );
}

function StateChip({
  state,
  reviewed,
  sourceLabel,
  t,
}: {
  state: string;
  /** She read this draft and kept it as written — not the same as "clear evidence". */
  reviewed?: boolean;
  sourceLabel: string;
  t: (key: string) => string;
}) {
  const style =
    state === "attention"
      ? "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light"
      : state === "edited"
        ? "bg-grey-100 text-text-secondary"
        : "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light";
  const label =
    state === "attention"
      ? t("state-attention")
      : state === "edited"
        ? t("state-edited")
        : reviewed
          ? t("state-confirmed")
          : t("state-clear");
  return (
    <>
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", style)}>{label}</span>
      {/* PRD §10.3 asks for patient report, practitioner observation and AI
          inference to stay VISUALLY distinct. It used to live in a `title`
          attribute: invisible on touch, undiscoverable on desktop, and not read
          as content by a screen reader. */}
      <span className="text-text-secondary border-grey-100 rounded-full border px-2 py-0.5 text-xs">{sourceLabel}</span>
    </>
  );
}
