"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";

import ConsentSheet from "@/components/product/consent-sheet";
import ConsultationRecorder from "@/components/product/consultation-recorder";
import DialogHeader from "@/components/product/dialog-header";
import { useOnboardingStatus } from "@/components/product/onboarding-status-provider";
import PatientQuickCreate from "@/components/product/patient-quick-create";
import PracticeContextForm from "@/components/product/practice-context-form";
import { useRecordingSessionOptional } from "@/components/product/recording-session-provider";
import ScheduleDialog from "@/components/product/schedule-dialog";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StepCelebrationDialog from "@/components/product/step-celebration-dialog";
import { DEFAULTS } from "@/config";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCheck from "@/icons/nexture/ni-check";
import { calendarDateInTimeZone, defaultAppointmentStart, weeklyOccurrences } from "@/lib/agenda";
import { ANAMNESIS_BLOCKS, type AnamnesisField, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { recordAudit } from "@/lib/audit";
import { getExperienceFacts } from "@/lib/onboarding";
import { listActivePatientOptions, type PatientOption } from "@/lib/patients";
import { ensureProTrial } from "@/lib/pro-trial";
import { trackProductEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * The guided trail: sign-up to a signed first record and a booked return,
 * without ever leaving.
 *
 * WHY IT LIVES HERE. `/onboarding` is a top-level route, outside
 * `app/(dashboard)` — no nav rail, no header, no command palette, by ROUTING
 * rather than by hiding. Until the trail is done, nothing on screen competes
 * with the step at hand. The shell adds only the commercial badge, the way out,
 * and `RecordingSessionProvider`, which the recorder cannot live without.
 *
 * WHY IT IS NOT A COPY OF THE REAL SCREENS. Every rule it touches is enforced
 * by the database or by an existing route — `start_manual_consultation`,
 * `save_consultation_header`, `save_consultation_answer`,
 * `confirm_anamnesis_answer`, `POST /api/consultations/{id}/finalize`,
 * `save_scheduled_consultation` via `saveAppointment`. A record created here is
 * the SAME record under the same invariants: a blank field is "não informado"
 * and deletes its row (PRD §10.5), a finalized consultation is frozen (PRD
 * §8.5), and audio capture is impossible without the patient's consent.
 *
 * WHY THE AI TRACK USES A REAL PATIENT. `consent_acceptances` is auditable and
 * never deleted — revoking only stamps `revoked_at`. A demo patient with a
 * recorded "verbal consent" would make the database assert, permanently, that a
 * person authorised audio capture and AI processing. There is no honest
 * shortcut: the trail records a real first consultation, or it records nothing.
 */

type Track = "manual" | "ai";
const isTrack = (value: string | null): value is Track => value === "manual" || value === "ai";

/** Every step this trail can show, in the order they can appear. */
type StepKey =
  | "context"
  | "patient"
  | "trial"
  | "consent"
  | "record"
  | "review"
  | "complaint"
  | "anamnesis"
  | "finalize"
  | "schedule";

/**
 * The three fields of the `complaint` block, by key rather than by position: a
 * renamed field must disappear from the trail, never silently become a
 * different question. Labels are the catalog's own i18n keys, so the guided
 * step asks exactly what the real consultation asks.
 */
const GUIDED_FIELD_KEYS = ["onset", "intensity", "factors"] as const;
const COMPLAINT_BLOCK = ANAMNESIS_BLOCKS.find((block) => block.key === "complaint");
const GUIDED_FIELDS: AnamnesisField[] = GUIDED_FIELD_KEYS.map((key) =>
  COMPLAINT_BLOCK?.fields.find((field) => field.key === key),
).filter((field): field is AnamnesisField => Boolean(field));

/** The embedded forms the wizard's primary button submits (`form={id}`). */
const CONTEXT_FORM_ID = "guide-context-form";
const PATIENT_FORM_ID = "guide-patient-form";

/** Audio first: without it there is no capture at all. Then the AI processing. */
const CONSENT_SLUGS = ["audio-recording", "ai-processing"] as const;
type ConsentSlug = (typeof CONSENT_SLUGS)[number];

type ConsentTerm = { id: string; slug: string; version: number; title: string; body: string };
type OpenConsent = { slug: ConsentSlug; term: ConsentTerm | null; index: number; slugs: ConsentSlug[] };

/** Where an AI value came from in the transcript (PRD §13.1), as the extraction stamps it. */
type Provenance = { quote?: string; start?: string; speaker?: string; verified?: boolean; transcriptionId?: string };

/** One answer the AI wrote, as the review step shows it. */
type ReviewItem = {
  blockKey: string;
  fieldKey: string;
  value: string;
  /** attention | clear | edited — the row's own state. */
  state: string;
  source: string;
  /** She kept an "attention" value as written (confirm_anamnesis_answer). */
  reviewed: boolean;
  label: string;
  provenance: Provenance | null;
};

type AnswerRow = {
  block_key: unknown;
  field_key: unknown;
  value: unknown;
  state: unknown;
  source: unknown;
  provenance: unknown;
  reviewed_at: unknown;
};

/** The columns every read of the answers needs, in one place. */
const ANSWER_COLUMNS = "block_key, field_key, value, state, source, provenance, reviewed_at";

/** Label for an answer the model wrote, from the same catalog the screens use. */
function labelFor(blockKey: string, fieldKey: string): string {
  const block = ANAMNESIS_BLOCKS.find((candidate) => candidate.key === blockKey);
  return block?.fields.find((field) => field.key === fieldKey)?.label ?? fieldKey;
}

/** Catalog order, so the review reads in the same sequence as the consultation screen. */
const FIELD_ORDER = new Map(
  ANAMNESIS_BLOCKS.flatMap((block, blockIndex) =>
    block.fields.map((field, fieldIndex) => [`${block.key}.${field.key}`, blockIndex * 100 + fieldIndex] as const),
  ),
);

/**
 * "The AI wrote this" — the same test the database applies when she edits a
 * value (migration 0059) and the consultation screen uses: the source says so,
 * or the extraction's transcript stamp does (a dictated tongue finding is stored
 * as `professional_voice`, so the source alone cannot tell).
 */
function isAiAuthored(row: AnswerRow): boolean {
  const provenance = row.provenance as Provenance | null;
  return row.source === "ai_inference" || row.source === "patient_report" || Boolean(provenance?.transcriptionId);
}

/**
 * EVERYTHING the AI wrote, not only what it flagged. The extraction marks a
 * value `clear` when its evidence is anchored and nothing in it is sensitive —
 * which is most of a normal consultation. Listing only `attention` meant the
 * trail froze a record full of AI text she had never been shown.
 */
function toReviewItems(rows: AnswerRow[]): ReviewItem[] {
  const rank = (item: ReviewItem) =>
    (item.state === "attention" ? 0 : 1_000_000) + (FIELD_ORDER.get(`${item.blockKey}.${item.fieldKey}`) ?? 999_999);
  return rows
    .filter((row) => isAiAuthored(row) && row.state !== "rejected" && String(row.value ?? "").trim())
    .map((row) => ({
      blockKey: String(row.block_key),
      fieldKey: String(row.field_key),
      value: String(row.value ?? ""),
      state: String(row.state),
      source: String(row.source),
      // Stamped by confirm_anamnesis_answer (0098), so it survives a reload.
      reviewed: Boolean(row.reviewed_at),
      label: labelFor(String(row.block_key), String(row.field_key)),
      provenance: (row.provenance as Provenance | null) ?? null,
    }))
    .sort((a, b) => rank(a) - rank(b));
}

/** A capture neither the recorder nor the server has finished with. */
const IN_FLIGHT = ["recording", "local", "uploading", "uploaded", "processing"];
/** The audio is on the server; only the processing is left. */
const SERVER_PENDING = ["uploaded", "processing"];
/**
 * How long processing may run before the trail offers a way past it. The route
 * itself gives up at 300s (`maxDuration`); past that the row is not coming back
 * on its own.
 */
const PROCESSING_STALL_MS = 6 * 60_000;

type RecordingFacts = { ready: boolean; inFlight: boolean; serverPending: string[]; failed: string[] };
const NO_RECORDINGS: RecordingFacts = { ready: false, inFlight: false, serverPending: [], failed: [] };

function summarizeRecordings(rows: { id: unknown; status: unknown }[]): RecordingFacts {
  return {
    ready: rows.some((row) => row.status === "ready"),
    inFlight: rows.some((row) => IN_FLIGHT.includes(String(row.status))),
    serverPending: rows.filter((row) => SERVER_PENDING.includes(String(row.status))).map((row) => String(row.id)),
    failed: rows.filter((row) => row.status === "failed").map((row) => String(row.id)),
  };
}

/** What the trail knows at load, before it picks the step to reopen on. */
type ResumeFacts = { hasContext: boolean; patient: boolean; recording: "ready" | "pending" | "failed" | "none" };

/** Why a recording is being discarded — each leads somewhere different after. */
type DiscardIntent = { intent: "skip" | "rerecord" | "finalize"; ids: string[] };

export default function GuidedTrailPage() {
  const t = useTranslations("product");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orgId, timezone } = useCurrentOrg();
  // The same reading the header badge shows (one provider in the shell), so the
  // trial step cannot offer a free trial while the badge says she just paid.
  const { status: commercial, reload: reloadCommercial } = useOnboardingStatus();

  const requested = searchParams.get("trilha");
  /**
   * "Registrar sem gravar" moves an AI-track trail onto the manual steps in
   * place — same patient, same consultation. The address follows (so a reload
   * resumes the manual steps), but the switch must not wait on it.
   */
  const [trackOverride, setTrackOverride] = useState<Track | null>(null);
  const track: Track = trackOverride ?? (isTrack(requested) ? requested : "manual");
  // A capture running in this tab (the provider owns it, not the page).
  const captureActive = Boolean(useRecordingSessionOptional()?.active);

  /**
   * One week out, same hour — or the next sensible slot if that is already past.
   *
   * Stable per time zone so the step list that closes over it is not rebuilt on
   * every render.
   */
  const suggestedReturn = useCallback(() => {
    const nextWeek = weeklyOccurrences(new Date(), 2, timezone)[1];
    return nextWeek.getTime() > Date.now()
      ? nextWeek
      : defaultAppointmentStart(calendarDateInTimeZone(new Date(), timezone), new Date(), timezone);
  }, [timezone]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [patients, setPatients] = useState<PatientOption[]>([]);

  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [consultationId, setConsultationId] = useState<string | null>(null);
  const [complaint, setComplaint] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [trialStarted, setTrialStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [trailDone, setTrailDone] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [patientSaving, setPatientSaving] = useState(false);
  /**
   * A step whose work finished asynchronously (a form saved, both consents on
   * record, a recording processed) asks to move on here; the effect below does
   * it with the CURRENT step list — never with the one a stale callback saw —
   * and only if she is still on that step.
   */
  const [pendingWarnings, setPendingWarnings] = useState<string[]>([]);
  const [advanceRequest, setAdvanceRequest] = useState<{ from: StepKey; celebrate: boolean } | null>(null);

  // --- consent (AI track) ---
  const [consents, setConsents] = useState<{ audio: boolean; ai: boolean }>({ audio: false, ai: false });
  /**
   * Opening the consultation for the recorder. The manual track opens it in the
   * complaint step; the AI track has no complaint step, and nothing opened it —
   * the record step waited for an id that never came, behind a spinner with no
   * way out. Measured in production: stuck on step 5 of 8.
   */
  const [opening, setOpening] = useState<"idle" | "opening" | "error">("idle");
  const [openConsent, setOpenConsent] = useState<OpenConsent | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  // --- recording + review (AI track) ---
  /** What the DATABASE holds for this consultation's recordings — never the recorder's local phase. */
  const [rec, setRec] = useState<RecordingFacts>(NO_RECORDINGS);
  /**
   * Resuming onto a recording whose processing this tab never saw end. The
   * recorder only recovers captures it still holds locally, and after the
   * upload it holds nothing — so the trail watches the row itself.
   */
  const [resumeWatching, setResumeWatching] = useState(false);
  const resumeWatchingRef = useRef(false);
  /** Recordings found failed (or stuck) when the trail loaded: the recorder does not know them. */
  const [resumeFailed, setResumeFailed] = useState<string[]>([]);
  const [stalled, setStalled] = useState(false);
  const [discard, setDiscard] = useState<DiscardIntent | null>(null);
  const [discarding, setDiscarding] = useState(false);
  /** The last read of `rec.ready`, so only the TRANSITION to ready moves her on. */
  const wasReady = useRef(false);
  const [aiAnswers, setAiAnswers] = useState<ReviewItem[]>([]);
  /** The one review card open for editing: `header.chief_complaint` or `block.field`. */
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);

  // --- scheduling ---
  /**
   * Frozen when the dialog opens, never rebuilt while it is on screen.
   *
   * `ScheduleDialog` re-runs its reset AND its patient load whenever the `seed`
   * IDENTITY changes. An inline `seed={{...}}` is a new object on every render,
   * so the dialog kept resetting itself and holding `patients` at null — which
   * is one of the three things that disable its save button. Measured: the
   * scheduler opened fully filled in and could never be submitted.
   */
  const [scheduleSeed, setScheduleSeed] = useState<{ patientId: string; startAt: string } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [trialFromAgenda, setTrialFromAgenda] = useState(false);

  // --- navigation + celebration ---
  const [stepIndex, setStepIndex] = useState(0);
  const [resume, setResume] = useState<ResumeFacts | null>(null);
  const seeded = useRef(false);
  /** A step to land on once the step list has been rebuilt (the manual switch). */
  const [jumpTo, setJumpTo] = useState<StepKey | null>(null);
  const [celebrating, setCelebrating] = useState<{ from: StepKey; to: number } | null>(null);
  // Only the FIRST crossing of a step is worth a celebration; walking back and
  // forth would otherwise re-congratulate her for the same thing.
  const celebrated = useRef<Set<StepKey>>(new Set());

  /**
   * The consultation's optimistic-lock counter, tracked exactly as the real
   * consultation screen tracks it. It matters more here than there: the AI
   * pipeline writes answers from the SERVER, bumping the revision under the
   * trail, so this is re-read whenever a recording lands.
   */
  const revisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!isSupabaseConfigured || !orgId) {
        if (active && orgId === null) setLoading(false);
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace(`/auth/sign-in?next=${encodeURIComponent("/onboarding/guia")}`);
          return;
        }
        const [facts, options] = await Promise.all([
          getExperienceFacts(supabase, user.id),
          listActivePatientOptions(supabase, orgId),
        ]);
        if (!active) return;
        // The list exists only to warn about a duplicate name. A workspace on
        // its first patient has none, so a failed read degrades to "no warning"
        // instead of blocking the trail on something that cannot matter yet.
        setPatients(options.ok ? options.data : []);

        // RESUMING: pick up the consultation the trail already opened.
        //
        // Without this, "pular guia" and come back reopened the complaint step
        // with an empty box — and the box is what unlocks "Continuar", so she
        // had to retype a chief complaint the database already held. Measured:
        // the trail resumed onto a step it had itself completed and blocked
        // there.
        //
        // Only while nothing has been finalized yet. Once she has closed a
        // record, walking the trail again is a NEW consultation, and dragging
        // the old one back would be the trail re-opening finished work.
        let resolvedPatient = false;
        let recording: ResumeFacts["recording"] = "none";
        if (!facts.hasFinalizedConsultation) {
          const { data: open } = await supabase
            .from("consultations")
            .select("id, clinical_revision, chief_complaint, patient_id")
            .eq("org_id", orgId)
            .in("status", ["draft", "in_progress", "awaiting_review"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (active && open?.id) {
            setConsultationId(open.id);
            revisionRef.current = Number(open.clinical_revision ?? 0);
            const complaintValue = String(open.chief_complaint ?? "").trim();
            if (complaintValue) setComplaint(complaintValue);
            const owner = (options.ok ? options.data : []).find((option) => option.id === open.patient_id);
            if (owner) {
              setPatient(owner);
              resolvedPatient = true;
            }
            const [{ data: saved }, { data: recordings }] = await Promise.all([
              supabase.from("anamnesis_answers").select(ANSWER_COLUMNS).eq("consultation_id", open.id),
              supabase.from("recordings").select("id, status").eq("consultation_id", open.id),
            ]);
            if (active && saved) {
              setAnswers(
                Object.fromEntries(
                  saved
                    .filter((row) => row.block_key === "complaint")
                    .map((row) => [String(row.field_key), String(row.value ?? "")]),
                ),
              );
              setAiAnswers(toReviewItems(saved));
            }
            if (active && recordings) {
              // Where the recording stands decides where she resumes. The page
              // used to learn it only from the recorder — which opens idle and
              // reports nothing until she acts — so a trail reloaded after the
              // audio was processed walked her back to "Grave o atendimento"
              // with no way forward but recording the consultation again.
              const recordingFacts = summarizeRecordings(recordings);
              setRec(recordingFacts);
              wasReady.current = recordingFacts.ready;
              if (recordingFacts.serverPending.length > 0) {
                resumeWatchingRef.current = true;
                setResumeWatching(true);
                // Nudge the pipeline: an upload whose processing request died
                // with the tab would otherwise stay "uploaded" forever. The
                // route claims the job, so a worker already on it is untouched.
                for (const id of recordingFacts.serverPending) {
                  void fetch(`/api/recordings/${id}/process`, { method: "POST" }).catch(() => undefined);
                }
              }
              if (recordingFacts.failed.length > 0) setResumeFailed(recordingFacts.failed);
              recording = recordingFacts.ready
                ? "ready"
                : recordingFacts.inFlight
                  ? "pending"
                  : recordingFacts.failed.length > 0
                    ? "failed"
                    : "none";
            }
          }
        }

        // Resume on the first thing that is not done, by KEY (see the seed
        // effect) — the two tracks have different step lists, and an index
        // computed here would be the wrong step the moment either list changes.
        //
        // It turns on the patient the trail is actually HOLDING, not on the
        // fact that the workspace has patients. Measured: after finalizing once,
        // `hasPatient` was true, nothing was hydrated (the record is closed), and
        // the trail opened on the complaint step with no patient — where the
        // finalize button is disabled forever, because there is no consultation
        // to finalize. A dead end reached by walking the trail twice.
        setResume({ hasContext: facts.hasPracticeContext, patient: resolvedPatient, recording });
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
    // Not on `track`: the load reads facts, and the seed effect turns them into
    // a step for whichever track is current. Re-running it on the manual switch
    // would re-read everything for nothing.
  }, [orgId, router]);

  /** Create (or recover) the open consultation for this patient. Idempotent. */
  const ensureConsultation = useCallback(async (): Promise<string | null> => {
    if (consultationId) return consultationId;
    if (!patient) return null;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("start_manual_consultation", { target_patient: patient.id });
    const result = data as { ok?: boolean; consultationId?: string } | null;
    if (error || !result?.ok || !result.consultationId) {
      setActionError(t("guide-consultation-error"));
      return null;
    }
    const { data: row } = await supabase
      .from("consultations")
      .select("clinical_revision")
      .eq("id", result.consultationId)
      .maybeSingle();
    revisionRef.current = Number(row?.clinical_revision ?? 0);
    setConsultationId(result.consultationId);
    return result.consultationId;
  }, [consultationId, patient, t]);

  /**
   * Re-read what the SERVER now holds for this consultation.
   *
   * `apply_recording_result` writes answers and may fill the chief complaint,
   * and every such write bumps `clinical_revision`. Without this the trail
   * would keep sending a stale `expectedRevision` and every later save — and
   * the finalize itself — would come back as a revision conflict.
   */
  const refreshClinical = useCallback(async (id: string) => {
    const supabase = createClient();
    const [{ data: row }, { data: rows }] = await Promise.all([
      supabase.from("consultations").select("clinical_revision, chief_complaint").eq("id", id).maybeSingle(),
      supabase.from("anamnesis_answers").select(ANSWER_COLUMNS).eq("consultation_id", id),
    ]);
    revisionRef.current = Number(row?.clinical_revision ?? revisionRef.current);
    const serverComplaint = String(row?.chief_complaint ?? "").trim();
    if (serverComplaint) setComplaint((current) => (current.trim() ? current : serverComplaint));
    setAiAnswers(toReviewItems(rows ?? []));
    return { answers: (rows ?? []).length };
  }, []);

  /**
   * One write against the same RPC the consultation screen uses. `value` is
   * the review step's edit; the manual step saves what is in the box.
   */
  const saveComplaint = useCallback(
    async (value?: string) => {
      const id = await ensureConsultation();
      if (!id) return false;
      const text = (value ?? complaint).trim();
      const { data, error } = await createClient().rpc("save_consultation_header", {
        target_consultation: id,
        expected_revision: revisionRef.current,
        target_field: "chief_complaint",
        target_value: text,
      });
      const result = data as { ok?: boolean; code?: string; revision?: number } | null;
      if (error || !result?.ok || !Number.isInteger(result.revision)) {
        // A review edit can race the pipeline writing under it; re-read, say
        // so, and let her save again against the fresh revision.
        if (value !== undefined && result?.code === "revision_conflict") {
          await refreshClinical(id);
          setActionError(t("guide-review-conflict"));
        } else {
          setActionError(t("guide-save-error"));
        }
        return false;
      }
      revisionRef.current = Number(result.revision);
      if (value !== undefined) setComplaint(text);
      return true;
    },
    [complaint, ensureConsultation, refreshClinical, t],
  );

  /**
   * Save the three guided answers. A blank one is skipped on purpose: the
   * database treats an empty value as "não informado" and DELETES the row, and
   * writing blanks here would be the trail teaching the opposite of the rule.
   */
  const saveAnswers = useCallback(async () => {
    const id = consultationId;
    if (!id) return false;
    const supabase = createClient();
    for (const field of GUIDED_FIELDS) {
      const value = (answers[field.key] ?? "").trim();
      if (!value) continue;
      const { data, error } = await supabase.rpc("save_consultation_answer", {
        target_consultation: id,
        expected_revision: revisionRef.current,
        target_block_key: "complaint",
        target_field_key: field.key,
        target_value: value,
        target_source: "professional",
        // "clear", not null: she typed this herself, so there is nothing for
        // her to review. Null would pass the RPC's guard — `null not in (...)`
        // is null, not true — and then fail on the NOT NULL column.
        target_state: "clear",
      });
      const result = data as { ok?: boolean; revision?: number } | null;
      if (error || !result?.ok || !Number.isInteger(result.revision)) {
        setActionError(t("guide-save-error"));
        return false;
      }
      revisionRef.current = Number(result.revision);
    }
    return true;
  }, [answers, consultationId, t]);

  /**
   * "Revisei e mantenho": clears the attention flag WITHOUT rewriting the value.
   * The card stays on screen, now reading "Revisado por você" — it is still
   * part of what she is about to sign.
   */
  const keepAnswer = useCallback(
    async (item: ReviewItem) => {
      const id = consultationId;
      if (!id || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const { data, error } = await createClient().rpc("confirm_anamnesis_answer", {
          target_consultation: id,
          target_block_key: item.blockKey,
          target_field_key: item.fieldKey,
          expected_value: item.value.trim(),
        });
        const result = data as { ok?: boolean; code?: string; revision?: number } | null;
        if (error || !result?.ok) {
          if (result?.code === "revision_conflict") {
            await refreshClinical(id);
            setActionError(t("guide-review-conflict"));
            return;
          }
          setActionError(t("guide-save-error"));
          return;
        }
        if (Number.isInteger(result.revision)) revisionRef.current = Number(result.revision);
        setAiAnswers((current) =>
          current.map((entry) =>
            entry.blockKey === item.blockKey && entry.fieldKey === item.fieldKey
              ? { ...entry, state: "clear", reviewed: true }
              : entry,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, consultationId, refreshClinical, t],
  );

  /**
   * Correct or discard what the AI wrote — the consultation screen's own write
   * (`save_consultation_answer`). The DATABASE decides what the change means
   * (0059): a new value on an AI draft is an edit that keeps the transcript
   * excerpt it came from; an empty one is a rejection that deletes the row and
   * is remembered, so reprocessing the audio never puts it back.
   */
  const saveReviewedAnswer = useCallback(
    async (item: ReviewItem, value: string): Promise<boolean> => {
      const id = consultationId;
      if (!id || busy) return false;
      setBusy(true);
      setActionError(null);
      const composite = `${item.blockKey}.${item.fieldKey}`;
      const source = PROFESSIONAL_OBSERVATION_FIELDS.has(composite) ? "professional_voice" : "professional";
      const text = value.trim();
      try {
        const { data, error } = await createClient().rpc("save_consultation_answer", {
          target_consultation: id,
          expected_revision: revisionRef.current,
          target_block_key: item.blockKey,
          target_field_key: item.fieldKey,
          target_value: text,
          target_source: source,
          target_state: "edited",
        });
        const result = data as { ok?: boolean; code?: string; revision?: number; state?: string | null } | null;
        if (error || !result?.ok || !Number.isInteger(result.revision)) {
          if (result?.code === "revision_conflict") {
            await refreshClinical(id);
            setActionError(t("guide-review-conflict"));
          } else {
            setActionError(t("guide-save-error"));
          }
          return false;
        }
        revisionRef.current = Number(result.revision);
        setAiAnswers((current) =>
          text
            ? current.map((entry) =>
                entry.blockKey === item.blockKey && entry.fieldKey === item.fieldKey
                  ? { ...entry, value: text, source, state: result.state ?? "edited", reviewed: false }
                  : entry,
              )
            : current.filter((entry) => !(entry.blockKey === item.blockKey && entry.fieldKey === item.fieldKey)),
        );
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, consultationId, refreshClinical, t],
  );

  const startTrial = useCallback(async (): Promise<boolean> => {
    if (!orgId || busy) return false;
    setBusy(true);
    setActionError(null);
    try {
      // The guide's own origin (migration 0114): an explicit start with no
      // operational action behind it, which "other" used to swallow — the
      // trials the onboarding converts could not be told apart.
      const response = await fetch("/api/billing/start-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, origin: "onboarding" }),
      });
      if (!response.ok) throw new Error("trial_failed");
      setTrialStarted(true);
      // The header badge reads the same state; it must not keep saying
      // "Gratuito" under a step that just said the trial is on.
      void reloadCommercial();
      trackProductEvent("journey.track_selected", { intent: "ai", origin: "onboarding" });
      return true;
    } catch {
      setActionError(t("guide-trial-error"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, orgId, reloadCommercial, t]);

  // ---------- consent ----------

  const openTerm = useCallback(async (slugs: ConsentSlug[], index: number) => {
    const slug = slugs[index];
    const { data } = await createClient()
      .from("consent_terms")
      .select("id, slug, version, title, body")
      .eq("slug", slug)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    setOpenConsent({ slug, term: (data as ConsentTerm | null) ?? null, index, slugs });
  }, []);

  const collectConsents = useCallback(async () => {
    const missing = CONSENT_SLUGS.filter((slug) => (slug === "audio-recording" ? !consents.audio : !consents.ai));
    await openTerm(missing.length > 0 ? [...missing] : [...CONSENT_SLUGS], 0);
  }, [consents.ai, consents.audio, openTerm]);

  const submitConsent = useCallback(
    async (input: { granted: boolean; method: "verbal" | "in_person" }) => {
      if (!openConsent || !patient || consentBusy) return;
      setConsentBusy(true);
      try {
        const response = await fetch(`/api/patients/${patient.id}/consents/${openConsent.slug}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          setActionError(t("guide-consent-error"));
          return;
        }
        // A refusal is a decision too — record it and move to the next purpose.
        const nextConsents = {
          ...consents,
          [openConsent.slug === "audio-recording" ? "audio" : "ai"]: input.granted,
        };
        setConsents(nextConsents);
        const { slugs, index } = openConsent;
        setOpenConsent(null);
        if (index + 1 < slugs.length) await openTerm(slugs, index + 1);
        // Both on record: the step is done, so the trail moves on by itself.
        else if (nextConsents.audio && nextConsents.ai) setAdvanceRequest({ from: "consent", celebrate: false });
      } catch {
        setActionError(t("guide-consent-error"));
      } finally {
        setConsentBusy(false);
      }
    },
    [consentBusy, consents, openConsent, openTerm, patient, t],
  );

  // ---------- recording ----------

  /**
   * Called by the recorder whenever its recordings change — and by the trail
   * itself while it watches a processing it resumed onto. It reports
   * "something moved", not a phase, so the trail asks the database where
   * things stand.
   */
  const onRecordingChanged = useCallback(async () => {
    const id = consultationId;
    if (!id) return;
    const { data } = await createClient().from("recordings").select("id, status").eq("consultation_id", id);
    const facts = summarizeRecordings(data ?? []);
    setRec(facts);
    if (facts.serverPending.length === 0) {
      setStalled(false);
      if (resumeWatchingRef.current) {
        // The processing she resumed onto has ended. If it ended in failure,
        // the recorder knows nothing of it (it holds no local audio), so the
        // step has to say it — and offer the ways past it.
        resumeWatchingRef.current = false;
        setResumeWatching(false);
        if (!facts.ready && facts.failed.length > 0) setResumeFailed(facts.failed);
      }
    }
    // Only on the transition to ready: coming back to this step with a
    // recording that was already processed must not push her forward again.
    if (facts.ready && !wasReady.current) {
      setAdvanceRequest({ from: "record", celebrate: true });
      // The capture may have started the trial (its confirmation dialog) and
      // spent minutes: the header badge re-reads once, here.
      void reloadCommercial();
    }
    wasReady.current = facts.ready;
    // The pipeline wrote under us: re-read the revision and the answers, or the
    // next save and the finalize both come back as conflicts.
    if (facts.ready) await refreshClinical(id);
  }, [consultationId, refreshClinical, reloadCommercial]);

  /**
   * "Registrar sem gravar": the same patient and the same consultation, on the
   * manual steps (queixa + anamnese). The AI track had no way past the consent
   * or the recording without a processed recording — a refused authorization,
   * a dead microphone or a failed processing left only "Pular guia".
   */
  const continueWithoutRecording = useCallback(() => {
    setTrackOverride("manual");
    // The address follows, so a reload resumes the manual steps.
    window.history.replaceState(null, "", "/onboarding/guia?trilha=manual");
    setJumpTo("complaint");
    trackProductEvent("journey.track_selected", { intent: "manual", origin: "onboarding_without_recording" });
  }, []);

  /**
   * A recording that never became usable blocks the finalize (`recording_pending`
   * counts `failed`, 0093) and, while it stands, a fresh capture would leave it
   * behind. Discarding is the recorder's own cancel — never a delete: the row
   * stays, marked cancelled, and the audit trail says who discarded it.
   */
  const discardRecordings = useCallback(
    async (ids: string[]) => {
      const supabase = createClient();
      for (const id of ids) {
        const response = await fetch(`/api/recordings/${id}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel", errorCode: "discarded_in_guide" }),
        });
        if (!response.ok) return false;
        await recordAudit(supabase, "recording.discarded", {
          orgId,
          entityType: "recording",
          entityId: id,
          metadata: { consultationId, origin: "onboarding" },
        });
      }
      return true;
    },
    [consultationId, orgId],
  );

  const skipRecording = useCallback(() => {
    // Anything that would block the manual finalize has to go first, and only
    // with her say-so: it is audio of a real consultation.
    const blocking = [...rec.failed, ...(stalled ? rec.serverPending : [])];
    if (blocking.length > 0) {
      setDiscard({ intent: "skip", ids: blocking });
      return;
    }
    continueWithoutRecording();
  }, [continueWithoutRecording, rec.failed, rec.serverPending, stalled]);

  const confirmDiscard = useCallback(async () => {
    if (!discard || discarding) return;
    setDiscarding(true);
    setActionError(null);
    try {
      const done = await discardRecordings(discard.ids);
      if (!done) {
        setActionError(t("guide-discard-error"));
        return;
      }
      resumeWatchingRef.current = false;
      setResumeWatching(false);
      setResumeFailed([]);
      setStalled(false);
      const { intent } = discard;
      setDiscard(null);
      await onRecordingChanged();
      if (intent === "skip") continueWithoutRecording();
    } catch {
      setActionError(t("guide-discard-error"));
    } finally {
      setDiscarding(false);
    }
  }, [continueWithoutRecording, discard, discardRecordings, discarding, onRecordingChanged, t]);

  /**
   * Consent comes from the DATABASE, never from what this page happened to see.
   *
   * It used to be local state that started false, so resuming the trail asked
   * her to register the patient's consent again — writing a SECOND acceptance
   * into a table that is auditable and never deleted. It is the same read the
   * recorder makes (`has_active_consent`), so the two cannot disagree.
   */
  useEffect(() => {
    if (!orgId || !patient) return;
    let active = true;
    const supabase = createClient();
    void Promise.all([
      supabase.rpc("has_active_consent", {
        target_org: orgId,
        target_patient: patient.id,
        term_slug: "audio-recording",
      }),
      supabase.rpc("has_active_consent", { target_org: orgId, target_patient: patient.id, term_slug: "ai-processing" }),
    ]).then(([audio, ai]) => {
      if (!active || audio.error || ai.error) return;
      setConsents({ audio: Boolean(audio.data), ai: Boolean(ai.data) });
    });
    return () => {
      active = false;
    };
  }, [orgId, patient]);

  const openForRecording = useCallback(async () => {
    setOpening("opening");
    const id = await ensureConsultation();
    setOpening(id ? "idle" : "error");
  }, [ensureConsultation]);

  // ---------- finalize ----------

  const finalize = useCallback(
    async (acknowledged: string[] = []): Promise<boolean> => {
      if (!consultationId || busy) return false;
      setBusy(true);
      setActionError(null);
      try {
        const saved = await saveAnswers();
        if (!saved) return false;
        const response = await fetch(`/api/consultations/${consultationId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: revisionRef.current, acknowledgedWarnings: acknowledged }),
        });
        if (response.ok) {
          setFinalized(true);
          setPendingWarnings([]);
          return true;
        }
        // The RPC answers with a NAMED cause; collapsing them into one message
        // is how "a recording is still processing" became "something failed".
        const body = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: { details?: { warnings?: string[] } };
        };
        const warnings = body.error?.details?.warnings ?? [];
        if (body.code === "finalization_confirmation_required" && warnings.length > 0) {
          // Never echo the warnings silently — that would be the trail signing
          // off on her behalf. They are listed, and the button re-sends them.
          setActionError(
            t("guide-finalize-warnings", {
              items: warnings.map((warning) => t(`guide-warning-${warning}`)).join(" · "),
            }),
          );
          setPendingWarnings(warnings);
          return false;
        }
        setActionError(
          body.code === "recording_pending"
            ? t("guide-finalize-recording-pending")
            : body.code === "clinical_revision_conflict"
              ? t("guide-finalize-conflict")
              : t("guide-finalize-error"),
        );
        if (body.code === "clinical_revision_conflict") await refreshClinical(consultationId);
        // Which recording is in the way: a FAILED one is something she can
        // discard right here (the step then offers it); one still processing
        // only needs time.
        if (body.code === "recording_pending") await onRecordingChanged();
        return false;
      } catch {
        setActionError(t("guide-finalize-error"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, consultationId, onRecordingChanged, refreshClinical, saveAnswers, t],
  );

  // ---------- steps ----------
  //
  // One rule for every step: the step's own action IS the wizard's primary
  // button. It used to be two controls for one decision — "Cadastrar e
  // selecionar" inside the step and a disabled "Continuar" beside it (plus a
  // second "Voltar"), then a green "done" panel that read as an extra step and
  // needed yet another click. Now the action runs, and the only confirmation is
  // the celebration dialog that leads into the next step.

  const stepList = useMemo<{ key: StepKey; step: WizardStep }[]>(() => {
    const entries: { key: StepKey; step: WizardStep }[] = [];

    entries.push({
      key: "context",
      step: {
        title: t("guide-context-title"),
        hint: t("guide-context-hint"),
        primaryFormId: CONTEXT_FORM_ID,
        primaryLabel: t("practice-context-save"),
        busy: contextSaving,
        content: (
          <PracticeContextForm
            embedded
            formId={CONTEXT_FORM_ID}
            onSubmittingChange={setContextSaving}
            onCompleted={() => {
              setAdvanceRequest({ from: "context", celebrate: false });
            }}
          />
        ),
      },
    });

    // Changing the patient is only offered while no consultation was opened for
    // the current one: after that, the record belongs to that patient.
    const canChangePatient = Boolean(patient) && !consultationId;
    entries.push({
      key: "patient",
      step: {
        title: t("guide-patient-title"),
        hint: t("guide-patient-hint"),
        ...(patient
          ? {}
          : {
              primaryFormId: PATIENT_FORM_ID,
              primaryLabel: t("guide-patient-cta"),
              busy: patientSaving,
            }),
        content: patient ? (
          // Only seen when she comes BACK to this step: after creating or
          // choosing, the trail has already moved on.
          <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
            <Typography variant="body1">{t("guide-patient-ready", { name: patient.fullName })}</Typography>
            {canChangePatient && (
              <Button variant="text" size="small" onClick={() => setPatient(null)}>
                {t("guide-patient-change")}
              </Button>
            )}
          </Box>
        ) : (
          <Box className="flex flex-col gap-4">
            {/* The example is the point of this step: a professional who has
                never used the product does not know how much to type. It shows
                the shape of an answer without pretending to be her data. */}
            <Alert severity="info">
              <Typography variant="subtitle2">{t("guide-patient-example-title")}</Typography>
              <Typography variant="body2">{t("guide-patient-example-body")}</Typography>
            </Alert>
            {/* Choosing someone already registered is a whole decision: it moves
                on at once. The trail never PICKS a patient for her — opening a
                consultation is a real clinical write. */}
            {patients.length > 0 && (
              <TextField
                select
                label={t("guide-patient-existing")}
                value=""
                onChange={(event) => {
                  const chosen = patients.find((option) => option.id === event.target.value);
                  if (!chosen) return;
                  // "Primeiro paciente cadastrado" would be false for someone
                  // she already had, so this crossing does not celebrate.
                  celebrated.current.add("patient");
                  setPatient(chosen);
                  setAdvanceRequest({ from: "patient", celebrate: false });
                }}
                slotProps={{ select: { native: true } }}
                fullWidth
              >
                <option value="">{t("guide-patient-existing-placeholder")}</option>
                {patients.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.fullName}
                  </option>
                ))}
              </TextField>
            )}
            <PatientQuickCreate
              embedded
              formId={PATIENT_FORM_ID}
              onSubmittingChange={setPatientSaving}
              orgId={orgId ?? ""}
              existingPatients={patients}
              onCreated={(created) => {
                setPatient(created);
                setPatients((current) => [...current, created]);
                setAdvanceRequest({ from: "patient", celebrate: true });
              }}
              onCancel={() => undefined}
            />
          </Box>
        ),
      },
    });

    if (track === "ai") {
      // What this step says depends on what she already has. It used to offer
      // "ative o teste Pro" to everyone — including someone who had just paid
      // by PIX, with the header badge reading "confirmando pagamento" above it.
      const paid = commercial?.kind === "plan";
      const paying = commercial?.kind === "pending_payment";
      const unconfirmed = commercial?.kind === "payment_unconfirmed";
      // The Pro she is paying for, honoured while the bank confirms (0111).
      const provisionalUntil = commercial?.kind === "pending_payment" ? commercial.provisionalUntil : null;
      const finishPaymentHref =
        commercial?.kind === "payment_unconfirmed" && commercial.planSlug
          ? `/assinatura?plan=${encodeURIComponent(commercial.planSlug)}`
          : "/settings/billing";
      const onTrial = trialStarted || commercial?.kind === "trial";
      const offerTrial = !paid && !paying && !unconfirmed && !onTrial;
      entries.push({
        key: "trial",
        step: {
          title: paid
            ? t("guide-ai-plan-title")
            : paying
              ? t("guide-ai-pending-title")
              : unconfirmed
                ? t("guide-ai-unconfirmed-title")
                : t("guide-ai-title"),
          hint: paid
            ? t("guide-ai-plan-hint")
            : paying
              ? t("guide-ai-pending-hint")
              : unconfirmed
                ? t("guide-ai-unconfirmed-hint")
                : t("guide-ai-hint"),
          ...(unconfirmed
            ? {
                primaryLabel: t("guide-ai-unconfirmed-cta"),
                onPrimary: () => {
                  router.push(finishPaymentHref);
                  return false;
                },
                secondary: {
                  label: t("continue"),
                  onClick: () => setAdvanceRequest({ from: "trial", celebrate: false }),
                },
              }
            : offerTrial
              ? {
                  // Never a gate: starting the trial is optional, and "Agora
                  // não" carries on without it.
                  primaryLabel: t("guide-ai-start-trial"),
                  onPrimary: startTrial,
                  secondary: {
                    label: t("celebration-later"),
                    onClick: () => setAdvanceRequest({ from: "trial", celebrate: false }),
                  },
                }
              : {}),
          content: (
            <Box className="flex flex-col gap-3">
              <Typography variant="body2" className="text-text-secondary">
                {t("guide-ai-body")}
              </Typography>
              {paying ? (
                <Alert severity="info" className="neutral bg-background-paper/60!">
                  {provisionalUntil
                    ? t("guide-ai-provisional-note", {
                        until: new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
                          new Date(provisionalUntil),
                        ),
                      })
                    : t("guide-ai-pending-note")}
                </Alert>
              ) : unconfirmed ? (
                // Amber, never red: an unconfirmed PIX is a billing matter.
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("guide-ai-unconfirmed-note")}
                </Alert>
              ) : onTrial ? (
                <Alert severity="success" icon={<NiCheck size="small" />}>
                  {t("guide-ai-trial-started")}
                </Alert>
              ) : null}
            </Box>
          ),
        },
      });

      const consentsDone = consents.audio && consents.ai;
      entries.push({
        key: "consent",
        step: {
          title: t("guide-consent-title"),
          hint: t("guide-consent-hint"),
          // Registering IS the step: the button opens the terms, and the trail
          // moves on by itself once both are on record.
          //
          // Offered whenever they are not both on record — not only after a
          // refusal in this session: a refusal on the FIRST ask leaves no row
          // behind (there is nothing to revoke), so a trail reopened later
          // could not tell "refused" from "never asked" and would trap her again.
          ...(consentsDone
            ? {}
            : {
                primaryLabel: t("guide-consent-cta"),
                onPrimary: async () => {
                  await collectConsents();
                  return false;
                },
                busy: consentBusy,
                secondary: { label: t("guide-skip-recording"), onClick: skipRecording },
              }),
          content: (
            <Box className="flex flex-col gap-3">
              <Alert severity="info">{t("guide-consent-body")}</Alert>
              <Box className="flex flex-col gap-2">
                <Alert severity={consents.audio ? "success" : "warning"} icon={consents.audio ? undefined : false}>
                  {t("guide-consent-audio", { state: t(consents.audio ? "guide-consent-on" : "guide-consent-off") })}
                </Alert>
                <Alert severity={consents.ai ? "success" : "warning"} icon={consents.ai ? undefined : false}>
                  {t("guide-consent-ai", { state: t(consents.ai ? "guide-consent-on" : "guide-consent-off") })}
                </Alert>
              </Box>
            </Box>
          ),
        },
      });

      // The way past the recording. Never while a capture runs or the server is
      // processing on time — only when there is nothing to wait for, or when
      // waiting has stopped making sense (the stall window).
      const canSkipRecording = !rec.ready && !captureActive && (!rec.inFlight || stalled);
      entries.push({
        key: "record",
        step: {
          title: t("guide-record-title"),
          hint: t("guide-record-hint"),
          // The recorder's own buttons are this step's action, and the step
          // moves on by itself when processing is ready — a "Continuar" here
          // would only sit disabled beside them. It appears once a processed
          // recording exists, including one found when the trail is reopened.
          canAdvance: rec.ready && !rec.inFlight,
          hidePrimary: !rec.ready,
          ...(canSkipRecording ? { secondary: { label: t("guide-skip-recording"), onClick: skipRecording } } : {}),
          content:
            patient && consultationId && orgId ? (
              <Box className="flex flex-col gap-3">
                {/* Someone who came through a payment path is never told about
                    a trial — not even in passing. */}
                <Alert severity="info">
                  {commercial && commercial.kind !== "free" && commercial.kind !== "trial"
                    ? t("guide-record-minutes-plan")
                    : t("guide-record-minutes")}
                </Alert>
                {resumeWatching ? (
                  // A processing she came back to: the recorder holds no local
                  // audio for it and would show an idle "Iniciar gravação" —
                  // which the server refuses while this row is open. Past the
                  // stall window it stops spinning and says so, beside the exit.
                  stalled ? (
                    <Alert severity="warning" className="neutral bg-background-paper/60!" role="status">
                      {t("guide-record-resume-slow")}
                    </Alert>
                  ) : (
                    <Alert
                      severity="info"
                      className="neutral bg-background-paper/60!"
                      icon={<CircularProgress size={18} aria-hidden />}
                      role="status"
                    >
                      {t("guide-record-resume-processing")}
                    </Alert>
                  )
                ) : resumeFailed.length > 0 ? (
                  // Found failed when the trail was reopened. A fresh capture
                  // beside it would leave a failed row that blocks the finalize,
                  // so the recorder waits until she decides about this one.
                  <Alert severity="warning" className="neutral bg-background-paper/60!">
                    <Box className="flex flex-col items-start gap-2">
                      {t("guide-record-stale-failed")}
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        disabled={discarding}
                        onClick={() => setDiscard({ intent: "rerecord", ids: resumeFailed })}
                      >
                        {t("guide-record-stale-discard")}
                      </Button>
                    </Box>
                  </Alert>
                ) : (
                  <>
                    {rec.ready && (
                      <Alert severity="success" icon={<NiCheck size="small" />}>
                        {t("guide-record-already")}
                      </Alert>
                    )}
                    <ConsultationRecorder
                      orgId={orgId}
                      patientId={patient.id}
                      consultationId={consultationId}
                      audioConsent={consents.audio}
                      aiConsent={consents.ai}
                      // STABLE references, both: an inline arrow here re-created
                      // the recorder's callbacks on every render of this page,
                      // which re-ran its recovery mid-capture and flagged the
                      // recording in progress as abandoned.
                      onRequestConsent={collectConsents}
                      onChanged={onRecordingChanged}
                      paymentPending={commercial?.kind === "pending_payment"}
                    />
                  </>
                )}
              </Box>
            ) : opening === "error" ? (
              // A failure is said as a failure, with the way out — never left
              // looking like something that is still loading.
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void openForRecording()}>
                    {t("retry")}
                  </Button>
                }
              >
                {t("guide-record-open-error")}
              </Alert>
            ) : (
              <Box className="flex items-center gap-3" role="status" aria-live="polite">
                <CircularProgress size={20} aria-hidden />
                <Typography variant="body2" className="text-text-secondary">
                  {t("guide-record-preparing")}
                </Typography>
              </Box>
            ),
        },
      });

      const COMPLAINT_KEY = "header.chief_complaint";
      entries.push({
        key: "review",
        step: {
          title: t("guide-review-title"),
          hint: t("guide-review-hint"),
          // Leaving fields flagged is allowed: finalizing them is a separate,
          // named decision on the next step. An open edit holds the step, so
          // a half-typed correction is never left behind unsaved.
          canAdvance: editing === null && !busy,
          content: (
            <Box className="flex flex-col gap-3">
              <Alert severity="info">{t("guide-review-body")}</Alert>
              {/* The chief complaint is the model's too on this track — it
                  fills it while empty (0092) — and it heads the record she signs. */}
              <ReviewCard
                label={t("consultation-chief-complaint")}
                value={complaint}
                emptyValue={t("guide-review-complaint-empty")}
                draft={editing?.key === COMPLAINT_KEY ? editing.value : null}
                busy={busy}
                onEdit={() => setEditing({ key: COMPLAINT_KEY, value: complaint })}
                onDraftChange={(value) => setEditing({ key: COMPLAINT_KEY, value })}
                onCancel={() => setEditing(null)}
                onSave={async (value) => {
                  if (await saveComplaint(value)) setEditing(null);
                }}
                t={t}
              />
              {aiAnswers.length === 0 ? (
                <Alert severity="info" className="neutral bg-background-paper/60!">
                  {t("guide-review-empty")}
                </Alert>
              ) : (
                aiAnswers.map((item) => {
                  const key = `${item.blockKey}.${item.fieldKey}`;
                  return (
                    <ReviewCard
                      key={key}
                      // A field retired from the catalog still shows, under its key.
                      label={t.has(item.label) ? t(item.label) : item.fieldKey}
                      value={item.value}
                      state={item.state}
                      reviewed={item.reviewed}
                      sourceLabel={t(`source-${item.source}`)}
                      provenance={item.provenance}
                      draft={editing?.key === key ? editing.value : null}
                      busy={busy}
                      onEdit={() => setEditing({ key, value: item.value })}
                      onDraftChange={(value) => setEditing({ key, value })}
                      onCancel={() => setEditing(null)}
                      onSave={async (value) => {
                        if (await saveReviewedAnswer(item, value)) setEditing(null);
                      }}
                      onClearField={async () => {
                        if (await saveReviewedAnswer(item, "")) setEditing(null);
                      }}
                      onKeep={item.state === "attention" && !item.reviewed ? () => void keepAnswer(item) : undefined}
                      t={t}
                    />
                  );
                })
              )}
            </Box>
          ),
        },
      });
    } else {
      entries.push({
        key: "complaint",
        step: {
          title: t("guide-complaint-title"),
          hint: t("guide-complaint-hint"),
          canAdvance: complaint.trim().length > 2,
          // Saved when she moves on — once, not on every blur.
          onPrimary: () => saveComplaint(),
          content: (
            <Box className="flex flex-col gap-3">
              <Alert severity="info">{t("guide-complaint-example")}</Alert>
              <TextField
                label={t("consultation-chief-complaint")}
                value={complaint}
                onChange={(event) => setComplaint(event.target.value)}
                multiline
                minRows={2}
                fullWidth
              />
            </Box>
          ),
        },
      });

      entries.push({
        key: "anamnesis",
        step: {
          title: t("guide-anamnesis-title"),
          hint: t("guide-anamnesis-hint"),
          // Everything here is optional by design: the product's own rule is
          // that a blank field means "não informado", so requiring answers to
          // advance would teach the opposite.
          onPrimary: saveAnswers,
          content: (
            <Box className="flex flex-col gap-4">
              <Alert severity="info">{t("guide-anamnesis-optional")}</Alert>
              {GUIDED_FIELDS.map((field) => (
                <TextField
                  key={field.key}
                  label={t(field.label)}
                  value={answers[field.key] ?? ""}
                  onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))}
                  multiline={field.multiline}
                  minRows={field.multiline ? 2 : 1}
                  fullWidth
                />
              ))}
            </Box>
          ),
        },
      });
    }

    entries.push({
      key: "finalize",
      step: {
        title: t("guide-finalize-title"),
        hint: t("guide-finalize-hint"),
        // The freeze IS the button. Success leads straight into the "Prontuário
        // fechado" celebration and on to the return appointment.
        ...(finalized
          ? {}
          : {
              primaryLabel: pendingWarnings.length > 0 ? t("guide-finalize-cta-confirm") : t("guide-finalize-cta"),
              onPrimary: () => finalize(pendingWarnings),
              busy,
            }),
        canAdvance: finalized || Boolean(consultationId),
        content: finalized ? (
          <Typography variant="body1">{t("guide-finalize-done")}</Typography>
        ) : (
          <Box className="flex flex-col gap-3">
            {/* Finalizing is the one irreversible act in the trail; saying so
                before the button is the difference between a guided flow and
                a trap. Corrections after this are addenda. */}
            <Alert severity="warning">{t("guide-finalize-warning")}</Alert>
            {/* A failed recording refuses the finalize (`recording_pending`,
                0093), and on the manual steps there is no recorder to clear it
                from — so the way out is offered where the refusal lands. */}
            {rec.failed.length > 0 && !rec.inFlight && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                <Box className="flex flex-col items-start gap-2">
                  {t("guide-finalize-failed-recording")}
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    disabled={discarding}
                    onClick={() => setDiscard({ intent: "finalize", ids: rec.failed })}
                  >
                    {t("guide-discard-cta")}
                  </Button>
                </Box>
              </Alert>
            )}
            <Typography variant="body2" className="text-text-secondary">
              {t("guide-finalize-summary", { name: patient?.fullName ?? "", complaint: complaint.trim() })}
            </Typography>
          </Box>
        ),
      },
    });

    entries.push({
      key: "schedule",
      step: {
        title: t("guide-schedule-title"),
        hint: t("guide-schedule-hint"),
        // Booking IS the step; saving the appointment completes the trail.
        // Finishing without one is the second way through — a first
        // consultation does not always have a return.
        primaryLabel: t("guide-schedule-cta"),
        canAdvance: Boolean(orgId && patient),
        onPrimary: () => {
          if (!patient) return false;
          setScheduleSeed({ patientId: patient.id, startAt: suggestedReturn().toISOString() });
          setScheduleOpen(true);
          return false;
        },
        secondary: { label: t("guide-schedule-skip"), onClick: () => setTrailDone(true) },
        content: <Alert severity="info">{t("guide-schedule-body")}</Alert>,
      },
    });

    return entries;
  }, [
    aiAnswers,
    answers,
    busy,
    captureActive,
    collectConsents,
    commercial,
    complaint,
    consentBusy,
    consents.ai,
    consents.audio,
    consultationId,
    contextSaving,
    discarding,
    editing,
    finalize,
    finalized,
    keepAnswer,
    onRecordingChanged,
    openForRecording,
    opening,
    orgId,
    patient,
    patientSaving,
    patients,
    pendingWarnings,
    rec,
    resumeFailed,
    resumeWatching,
    router,
    saveAnswers,
    saveComplaint,
    saveReviewedAnswer,
    skipRecording,
    stalled,
    startTrial,
    suggestedReturn,
    t,
    track,
    trialStarted,
  ]);

  // Seed the opening step ONCE, by key: doing it on every render would drag her
  // back the moment a background read lands.
  //
  // On the AI track it follows the RECORDING, not only the patient: processed
  // → the review; still in flight, failed or stuck → the record step, which
  // says so and offers the way past it; nothing yet → the trial step, as before.
  useEffect(() => {
    if (seeded.current || !resume || stepList.length === 0) return;
    const key: StepKey = !resume.hasContext
      ? "context"
      : !resume.patient
        ? "patient"
        : track === "ai"
          ? resume.recording === "ready"
            ? "review"
            : resume.recording === "none"
              ? "trial"
              : "record"
          : "complaint";
    const at = stepList.findIndex((entry) => entry.key === key);
    seeded.current = true;
    if (at <= 0) return;
    // What she finished in an earlier session is not celebrated again when she
    // walks back across it.
    for (const entry of stepList.slice(0, at)) celebrated.current.add(entry.key);
    setStepIndex(at);
  }, [resume, stepList, track]);

  // The manual switch lands on its step only once the list has been rebuilt
  // for the new track; an index computed before that points into the old list.
  useEffect(() => {
    if (!jumpTo) return;
    const at = stepList.findIndex((entry) => entry.key === jumpTo);
    if (at < 0) return;
    setJumpTo(null);
    setStepIndex(at);
  }, [jumpTo, stepList]);

  // Entering the record step opens the consultation the recorder needs. It
  // runs when she ARRIVES, not earlier: creating the record at the consent step
  // would leave an empty open consultation behind for anyone who stops there.
  const currentKey = stepList[stepIndex]?.key;
  useEffect(() => {
    if (currentKey !== "record" || !patient || consultationId || opening !== "idle") return;
    void openForRecording();
  }, [consultationId, currentKey, openForRecording, opening, patient]);

  /**
   * Watch a processing the server still owns. In this tab the recorder polls
   * its own capture, but it gives up after five minutes and never sees one it
   * resumed onto — and the route itself stops at 300s. Past the stall window
   * the step stops promising "almost there" and offers the way past it.
   */
  const pendingSince = useRef<number | null>(null);
  const serverPendingCount = rec.serverPending.length;
  useEffect(() => {
    if (currentKey !== "record" || !consultationId || serverPendingCount === 0) {
      pendingSince.current = null;
      return;
    }
    pendingSince.current ??= Date.now();
    const timer = window.setInterval(() => {
      void onRecordingChanged();
      if (pendingSince.current !== null && Date.now() - pendingSince.current > PROCESSING_STALL_MS) setStalled(true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [consultationId, currentKey, onRecordingChanged, serverPendingCount]);

  /** What each milestone says once it is behind her. Silence = no celebration. */
  const CELEBRATION: Partial<Record<StepKey, { title: string; accomplished: string }>> = useMemo(
    () => ({
      patient: { title: t("celebrate-patient-title"), accomplished: t("celebrate-patient-body") },
      record: { title: t("celebrate-record-title"), accomplished: t("celebrate-record-body") },
      finalize: { title: t("celebrate-finalize-title"), accomplished: t("celebrate-finalize-body") },
    }),
    [t],
  );

  const requestIndex = useCallback(
    (next: number, options: { celebrate?: boolean } = {}) => {
      const current = stepList[stepIndex]?.key;
      // Only forward moves celebrate, only the first time across, and never
      // when the crossing is not the milestone the dialog would name.
      if (
        options.celebrate !== false &&
        next > stepIndex &&
        current &&
        CELEBRATION[current] &&
        !celebrated.current.has(current)
      ) {
        celebrated.current.add(current);
        setCelebrating({ from: current, to: next });
        return;
      }
      setStepIndex(next);
    },
    [CELEBRATION, stepIndex, stepList],
  );

  useEffect(() => {
    if (!advanceRequest) return;
    const at = stepList.findIndex((entry) => entry.key === advanceRequest.from);
    setAdvanceRequest(null);
    // A late completion must not move her if she has already gone elsewhere.
    if (at >= 0 && at === stepIndex) requestIndex(at + 1, { celebrate: advanceRequest.celebrate });
  }, [advanceRequest, requestIndex, stepIndex, stepList]);

  if (loading)
    return (
      <Box className="flex min-h-72 w-full items-center justify-center">
        <CircularProgress aria-label={t("loading")} />
      </Box>
    );

  if (loadError)
    return (
      <Box className="w-full max-w-2xl">
        <Alert severity="error">{t("guide-load-error")}</Alert>
      </Box>
    );

  if (trailDone)
    return (
      <Box className="flex w-full max-w-2xl flex-col items-center gap-5 py-8 text-center">
        <span className="bg-accent-1/15 text-accent-1 flex h-14 w-14 items-center justify-center rounded-2xl">
          <NiCheck size="large" />
        </span>
        <Typography variant="h1" component="h1">
          {t("guide-done-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary max-w-lg leading-6">
          {t("guide-done-body")}
        </Typography>
        {scheduled && <Typography variant="body2">{t("guide-schedule-done")}</Typography>}
        {/* Saving the appointment can START the Pro trial (migration 0084); a
            trial that begins in silence is a clock she never saw. */}
        {trialFromAgenda && (
          <Alert severity="info" className="text-left">
            {t("trial-auto-started")}
          </Alert>
        )}
        <Box className="flex flex-wrap items-center justify-center gap-2">
          <Button LinkComponent={Link} href={DEFAULTS.appRoot} variant="contained" color="primary">
            {t("guide-done-cta")}
          </Button>
          {consultationId && (
            <Button LinkComponent={Link} href={`/consultas/${consultationId}`} variant="outlined" color="grey">
              {t("guide-done-open-record")}
            </Button>
          )}
        </Box>
      </Box>
    );

  const celebration = celebrating ? CELEBRATION[celebrating.from] : null;
  const nextStep = celebrating ? stepList[celebrating.to] : null;

  return (
    <Box className="flex w-full max-w-2xl flex-col gap-3">
      <SetupWizard
        steps={stepList.map((entry) => entry.step)}
        index={stepIndex}
        onIndexChange={requestIndex}
        completeLabel={t("guide-trail-finish")}
        onComplete={() => setTrailDone(true)}
      />
      {actionError && <Alert severity="error">{actionError}</Alert>}

      {celebration && nextStep && (
        <StepCelebrationDialog
          open
          title={celebration.title}
          accomplished={celebration.accomplished}
          nextTitle={nextStep.step.title}
          nextHint={nextStep.step.hint}
          ctaLabel={t("celebration-continue")}
          onNext={() => {
            const to = celebrating!.to;
            setCelebrating(null);
            setStepIndex(to);
          }}
          onClose={() => setCelebrating(null)}
        />
      )}

      {openConsent && patient && (
        <ConsentSheet
          open
          label={t(openConsent.slug === "audio-recording" ? "consent-audio-label" : "consent-ai-label")}
          progress={
            openConsent.slugs.length > 1
              ? t("consent-sequence", { current: openConsent.index + 1, total: openConsent.slugs.length })
              : undefined
          }
          purpose={t(openConsent.slug === "audio-recording" ? "consent-audio-hint" : "consent-ai-hint")}
          term={openConsent.term}
          active={openConsent.slug === "audio-recording" ? consents.audio : consents.ai}
          acceptedAt={null}
          currentMethod={null}
          busy={consentBusy}
          onClose={() => setOpenConsent(null)}
          onSubmit={submitConsent}
        />
      )}

      {scheduleOpen && scheduleSeed && orgId && patient && (
        <ScheduleDialog
          open
          orgId={orgId}
          timeZone={timezone}
          // The FROZEN seed (see `scheduleSeed`). It opens on a suggestion —
          // one week out, same wall-clock time — which is the same offer the
          // consultation screen makes; `weeklyOccurrences` exists precisely so
          // this is not `add(7,'day')`, which shifts the hour across DST.
          seed={scheduleSeed ?? undefined}
          origin="onboarding"
          onClose={() => {
            setScheduleOpen(false);
            setScheduleSeed(null);
          }}
          onSaved={async () => {
            setScheduleOpen(false);
            setScheduleSeed(null);
            setScheduled(true);
            // Saving an appointment is an operational action and can START the
            // Pro trial (migration 0084). A trial that begins in silence is a
            // clock she never saw, so the step says so when it happens.
            const { started } = await ensureProTrial(orgId, "agenda");
            if (started) {
              setTrialFromAgenda(true);
              void reloadCommercial();
            }
            // Booking was the step's action: the trail is complete.
            setTrailDone(true);
          }}
        />
      )}

      {/* Discarding is audio of a real consultation: it is always asked, and
          the button says where she goes next. */}
      {discard && (
        <Dialog
          open
          onClose={() => (discarding ? undefined : setDiscard(null))}
          maxWidth="xs"
          fullWidth
          aria-labelledby={DISCARD_TITLE_ID}
        >
          <DialogHeader
            id={DISCARD_TITLE_ID}
            title={t("guide-discard-title")}
            onClose={() => (discarding ? undefined : setDiscard(null))}
            closeLabel={t("close")}
            className="pb-0!"
          />
          <DialogContent>
            <Typography variant="body1" className="text-text-secondary leading-6">
              {t("guide-discard-body")}
            </Typography>
          </DialogContent>
          <DialogActions className="justify-start">
            <Button variant="contained" color="primary" disabled={discarding} onClick={() => void confirmDiscard()}>
              {discarding
                ? t("saving")
                : t(
                    discard.intent === "skip"
                      ? "guide-discard-cta-skip"
                      : discard.intent === "rerecord"
                        ? "guide-record-stale-discard"
                        : "guide-discard-cta",
                  )}
            </Button>
            <Button variant="text" color="grey" disabled={discarding} onClick={() => setDiscard(null)}>
              {t("cancel")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

const DISCARD_TITLE_ID = "guide-discard-title";

/**
 * The consultation screen's state + source chips (PRD §10.3 keeps patient
 * report, practitioner observation and AI inference visually distinct), so a
 * value reads the same in the trail as on the record.
 */
function AnswerStateChips({
  state,
  reviewed,
  sourceLabel,
  t,
}: {
  state: string;
  reviewed: boolean;
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
      <span className="text-text-secondary border-grey-100 rounded-full border px-2 py-0.5 text-xs">{sourceLabel}</span>
    </>
  );
}

/**
 * One value she is about to sign, as the review shows it: what it says, how it
 * got there (state, source and the transcript excerpt), and what she can do
 * about it — keep it as written, correct it, or leave it "não informado".
 */
function ReviewCard({
  label,
  value,
  emptyValue,
  state,
  reviewed = false,
  sourceLabel,
  provenance,
  draft,
  busy,
  onEdit,
  onDraftChange,
  onCancel,
  onSave,
  onClearField,
  onKeep,
  t,
}: {
  label: string;
  value: string;
  /** Shown when there is no value (the chief complaint can be empty). */
  emptyValue?: string;
  state?: string;
  reviewed?: boolean;
  sourceLabel?: string;
  provenance?: Provenance | null;
  /** The text being edited, or null when the card is not in edit mode. */
  draft: string | null;
  busy: boolean;
  onEdit: () => void;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: (value: string) => void | Promise<void>;
  onClearField?: () => void | Promise<void>;
  onKeep?: () => void;
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const origin = [t("field-provenance"), provenance?.speaker, provenance?.start].filter(Boolean).join(" · ");
  return (
    <Box
      className={cn(
        "border-grey-100 flex flex-col gap-2 rounded-2xl border p-3",
        state === "attention" && !reviewed && "border-accent-3/40",
      )}
    >
      <Box className="flex flex-row items-start justify-between gap-2">
        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Typography variant="subtitle2" component="h3" className="mb-0">
            {label}
          </Typography>
          {state && sourceLabel && (
            <AnswerStateChips state={state} reviewed={reviewed} sourceLabel={sourceLabel} t={t} />
          )}
        </Box>
        {/* Top right: a text button at the start of the actions row sat
            indented by its own padding, out of line with the value above. The
            negative margin keeps its hit area without growing the header row. */}
        {draft === null && (
          <Button
            size="small"
            variant="text"
            className="-my-1.5 flex-none"
            disabled={busy}
            aria-label={t("guide-review-edit-label", { field: label })}
            onClick={onEdit}
          >
            {t("guide-review-edit")}
          </Button>
        )}
      </Box>

      {draft === null ? (
        <Typography
          variant="body2"
          className={cn("leading-5 whitespace-pre-line", value.trim() ? "text-text-primary" : "text-text-secondary")}
        >
          {value.trim() || emptyValue}
        </Typography>
      ) : (
        <TextField
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          multiline
          minRows={2}
          fullWidth
          autoFocus
          size="small"
          slotProps={{ htmlInput: { "aria-label": label } }}
        />
      )}

      {/* The evidence, inline: the review exists to check it (PRD §13.1). A
          quote the pipeline could not locate is shown WITH that fact. */}
      {provenance?.quote && (
        <Box className="border-grey-100 flex flex-col gap-0.5 border-l-2 pl-3">
          <Typography variant="caption" className="text-text-secondary">
            {origin}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-5 italic">
            “{provenance.quote}”
          </Typography>
          {provenance.verified === false && (
            <Typography variant="caption" className="text-accent-3-dark dark:text-accent-3-light leading-5">
              {t("field-provenance-unverified")}
            </Typography>
          )}
        </Box>
      )}

      {draft === null ? (
        onKeep && (
          <Button
            size="small"
            variant="outlined"
            className="self-start"
            disabled={busy}
            aria-label={t("guide-review-keep-label", { field: label })}
            onClick={onKeep}
          >
            {t("guide-review-keep")}
          </Button>
        )
      ) : (
        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Button size="small" variant="contained" color="primary" disabled={busy} onClick={() => void onSave(draft)}>
            {busy ? t("saving") : t("save")}
          </Button>
          {onClearField && (
            <Button size="small" variant="text" color="grey" disabled={busy} onClick={() => void onClearField()}>
              {t("guide-review-clear-field")}
            </Button>
          )}
          <Button size="small" variant="text" color="grey" disabled={busy} onClick={onCancel}>
            {t("cancel")}
          </Button>
        </Box>
      )}
    </Box>
  );
}
