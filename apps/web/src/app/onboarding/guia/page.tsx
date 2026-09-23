"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, TextField, Typography } from "@mui/material";

import ConsentSheet from "@/components/product/consent-sheet";
import ConsultationRecorder from "@/components/product/consultation-recorder";
import PatientQuickCreate from "@/components/product/patient-quick-create";
import PracticeContextForm from "@/components/product/practice-context-form";
import ScheduleDialog from "@/components/product/schedule-dialog";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StepCelebrationDialog from "@/components/product/step-celebration-dialog";
import { DEFAULTS } from "@/config";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCheck from "@/icons/nexture/ni-check";
import { calendarDateInTimeZone, defaultAppointmentStart, weeklyOccurrences } from "@/lib/agenda";
import { ANAMNESIS_BLOCKS, type AnamnesisField } from "@/lib/anamnesis";
import { getExperienceFacts } from "@/lib/onboarding";
import { listActivePatientOptions, type PatientOption } from "@/lib/patients";
import { ensureProTrial } from "@/lib/pro-trial";
import { trackProductEvent } from "@/lib/product-events";
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

/** Audio first: without it there is no capture at all. Then the AI processing. */
const CONSENT_SLUGS = ["audio-recording", "ai-processing"] as const;
type ConsentSlug = (typeof CONSENT_SLUGS)[number];

type ConsentTerm = { id: string; slug: string; version: number; title: string; body: string };
type OpenConsent = { slug: ConsentSlug; term: ConsentTerm | null; index: number; slugs: ConsentSlug[] };
type AttentionAnswer = { blockKey: string; fieldKey: string; value: string; label: string };

/** Label for an answer the model wrote, from the same catalog the screens use. */
function labelFor(blockKey: string, fieldKey: string): string {
  const block = ANAMNESIS_BLOCKS.find((candidate) => candidate.key === blockKey);
  return block?.fields.find((field) => field.key === fieldKey)?.label ?? fieldKey;
}

export default function GuidedTrailPage() {
  const t = useTranslations("product");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orgId, timezone } = useCurrentOrg();

  const requested = searchParams.get("trilha");
  const track: Track = isTrack(requested) ? requested : "manual";

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

  const [hasContext, setHasContext] = useState(false);
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [consultationId, setConsultationId] = useState<string | null>(null);
  const [complaint, setComplaint] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [trialStarted, setTrialStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [trailDone, setTrailDone] = useState(false);

  // --- consent (AI track) ---
  const [consents, setConsents] = useState<{ audio: boolean; ai: boolean }>({ audio: false, ai: false });
  const [openConsent, setOpenConsent] = useState<OpenConsent | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  // --- recording + review (AI track) ---
  const [recordingReady, setRecordingReady] = useState(false);
  const [recordingBlocking, setRecordingBlocking] = useState(false);
  const [attention, setAttention] = useState<AttentionAnswer[]>([]);

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
  const [firstOpenKey, setFirstOpenKey] = useState<StepKey | null>(null);
  const seeded = useRef(false);
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
        setHasContext(facts.hasPracticeContext);

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
            const { data: saved } = await supabase
              .from("anamnesis_answers")
              .select("block_key, field_key, value, state")
              .eq("consultation_id", open.id);
            if (active && saved) {
              setAnswers(
                Object.fromEntries(
                  saved
                    .filter((row) => row.block_key === "complaint")
                    .map((row) => [String(row.field_key), String(row.value ?? "")]),
                ),
              );
              setAttention(
                saved
                  .filter((row) => row.state === "attention")
                  .map((row) => ({
                    blockKey: String(row.block_key),
                    fieldKey: String(row.field_key),
                    value: String(row.value ?? ""),
                    label: labelFor(String(row.block_key), String(row.field_key)),
                  })),
              );
            }
          }
        }

        // Resume on the first thing that is not done, by KEY — the two tracks
        // have different step lists, and an index computed here would be the
        // wrong step the moment either list changes.
        //
        // It turns on the patient the trail is actually HOLDING, not on the
        // fact that the workspace has patients. Measured: after finalizing once,
        // `hasPatient` was true, nothing was hydrated (the record is closed), and
        // the trail opened on the complaint step with no patient — where the
        // finalize button is disabled forever, because there is no consultation
        // to finalize. A dead end reached by walking the trail twice.
        setFirstOpenKey(
          !facts.hasPracticeContext ? "context" : !resolvedPatient ? "patient" : track === "ai" ? "trial" : "complaint",
        );
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
  }, [orgId, router, track]);

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
      supabase.from("anamnesis_answers").select("block_key, field_key, value, state").eq("consultation_id", id),
    ]);
    revisionRef.current = Number(row?.clinical_revision ?? revisionRef.current);
    const serverComplaint = String(row?.chief_complaint ?? "").trim();
    if (serverComplaint) setComplaint((current) => (current.trim() ? current : serverComplaint));
    const pending = (rows ?? [])
      .filter((answer) => answer.state === "attention")
      .map((answer) => ({
        blockKey: String(answer.block_key),
        fieldKey: String(answer.field_key),
        value: String(answer.value ?? ""),
        label: labelFor(String(answer.block_key), String(answer.field_key)),
      }));
    setAttention(pending);
    return { answers: (rows ?? []).length };
  }, []);

  /** One write against the same RPC the consultation screen uses. */
  const saveComplaint = useCallback(async () => {
    const id = await ensureConsultation();
    if (!id) return false;
    const { data, error } = await createClient().rpc("save_consultation_header", {
      target_consultation: id,
      expected_revision: revisionRef.current,
      target_field: "chief_complaint",
      target_value: complaint.trim(),
    });
    const result = data as { ok?: boolean; revision?: number } | null;
    if (error || !result?.ok || !Number.isInteger(result.revision)) {
      setActionError(t("guide-save-error"));
      return false;
    }
    revisionRef.current = Number(result.revision);
    return true;
  }, [complaint, ensureConsultation, t]);

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

  /** "Revisei e mantenho": clears the attention flag WITHOUT rewriting the value. */
  const keepAnswer = useCallback(
    async (item: AttentionAnswer) => {
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
        const result = data as { ok?: boolean; revision?: number } | null;
        if (error || !result?.ok) {
          setActionError(t("guide-save-error"));
          return;
        }
        if (Number.isInteger(result.revision)) revisionRef.current = Number(result.revision);
        setAttention((current) =>
          current.filter((entry) => !(entry.blockKey === item.blockKey && entry.fieldKey === item.fieldKey)),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, consultationId, t],
  );

  const startTrial = useCallback(async () => {
    if (!orgId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      // `origin` is limited by a CHECK constraint (migration 0084) to six
      // values, none of which is the guide; "other" is the honest catch-all
      // until that list gains one.
      const response = await fetch("/api/billing/start-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, origin: "other" }),
      });
      if (!response.ok) throw new Error("trial_failed");
      setTrialStarted(true);
      trackProductEvent("journey.track_selected", { intent: "ai", origin: "onboarding" });
    } catch {
      setActionError(t("guide-trial-error"));
    } finally {
      setBusy(false);
    }
  }, [busy, orgId, t]);

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
        setConsents((current) => ({
          ...current,
          [openConsent.slug === "audio-recording" ? "audio" : "ai"]: input.granted,
        }));
        const { slugs, index } = openConsent;
        setOpenConsent(null);
        if (index + 1 < slugs.length) await openTerm(slugs, index + 1);
      } catch {
        setActionError(t("guide-consent-error"));
      } finally {
        setConsentBusy(false);
      }
    },
    [consentBusy, openConsent, openTerm, patient, t],
  );

  // ---------- recording ----------

  /**
   * Called by the recorder whenever its recordings change. It reports "something
   * moved", not a phase, so the trail asks the database where things stand.
   */
  const onRecordingChanged = useCallback(async () => {
    const id = consultationId;
    if (!id) return;
    const { data } = await createClient().from("recordings").select("status").eq("consultation_id", id);
    const rows = data ?? [];
    const blocking = rows.some((row) =>
      ["recording", "local", "uploading", "uploaded", "processing", "failed"].includes(String(row.status)),
    );
    setRecordingBlocking(blocking);
    const ready = rows.some((row) => String(row.status) === "ready");
    setRecordingReady(ready);
    // The pipeline wrote under us: re-read the revision and the answers, or the
    // next save and the finalize both come back as conflicts.
    if (ready) await refreshClinical(id);
  }, [consultationId, refreshClinical]);

  // ---------- finalize ----------

  const finalize = useCallback(
    async (acknowledged: string[] = []) => {
      if (!consultationId || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const saved = await saveAnswers();
        if (!saved) return;
        const response = await fetch(`/api/consultations/${consultationId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: revisionRef.current, acknowledgedWarnings: acknowledged }),
        });
        if (response.ok) {
          setFinalized(true);
          return;
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
          return;
        }
        setActionError(
          body.code === "recording_pending"
            ? t("guide-finalize-recording-pending")
            : body.code === "clinical_revision_conflict"
              ? t("guide-finalize-conflict")
              : t("guide-finalize-error"),
        );
        if (body.code === "clinical_revision_conflict") await refreshClinical(consultationId);
      } catch {
        setActionError(t("guide-finalize-error"));
      } finally {
        setBusy(false);
      }
    },
    [busy, consultationId, refreshClinical, saveAnswers, t],
  );

  const [pendingWarnings, setPendingWarnings] = useState<string[]>([]);

  // ---------- steps ----------

  const stepList = useMemo<{ key: StepKey; step: WizardStep }[]>(() => {
    const entries: { key: StepKey; step: WizardStep }[] = [];

    entries.push({
      key: "context",
      step: {
        title: t("guide-context-title"),
        hint: t("guide-context-hint"),
        canAdvance: hasContext,
        content: hasContext ? (
          <Alert severity="success" icon={<NiCheck size="small" />}>
            {t("guide-context-done")}
          </Alert>
        ) : (
          <PracticeContextForm onCompleted={() => setHasContext(true)} />
        ),
      },
    });

    entries.push({
      key: "patient",
      step: {
        title: t("guide-patient-title"),
        hint: t("guide-patient-hint"),
        canAdvance: Boolean(patient),
        content: patient ? (
          <Alert severity="success" icon={<NiCheck size="small" />}>
            {t("guide-patient-ready", { name: patient.fullName })}
          </Alert>
        ) : (
          <Box className="flex flex-col gap-4">
            {/* The example is the point of this step: a professional who has
                never used the product does not know how much to type. It shows
                the shape of an answer without pretending to be her data. */}
            <Alert severity="info">
              <Typography variant="subtitle2">{t("guide-patient-example-title")}</Typography>
              <Typography variant="body2">{t("guide-patient-example-body")}</Typography>
            </Alert>
            {/* Someone who already registered a patient must be able to continue
                with that patient — and the trail must never PICK one for her:
                opening a consultation is a real clinical write. */}
            {patients.length > 0 && (
              <TextField
                select
                label={t("guide-patient-existing")}
                value=""
                onChange={(event) => {
                  const chosen = patients.find((option) => option.id === event.target.value);
                  if (chosen) setPatient(chosen);
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
              orgId={orgId ?? ""}
              existingPatients={patients}
              onCreated={(created) => {
                setPatient(created);
                setPatients((current) => [...current, created]);
              }}
              onCancel={() => undefined}
            />
          </Box>
        ),
      },
    });

    if (track === "ai") {
      entries.push({
        key: "trial",
        step: {
          title: t("guide-ai-title"),
          hint: t("guide-ai-hint"),
          // Never a gate: she chose the AI track, but the trail must not hold
          // the first record hostage to starting a trial.
          canAdvance: true,
          content: (
            <Box className="flex flex-col gap-3">
              <Typography variant="body2" className="text-text-secondary">
                {t("guide-ai-body")}
              </Typography>
              {trialStarted ? (
                <Alert severity="success" icon={<NiCheck size="small" />}>
                  {t("guide-ai-trial-started")}
                </Alert>
              ) : (
                <Button variant="contained" color="primary" onClick={startTrial} disabled={busy} className="self-start">
                  {t("guide-ai-start-trial")}
                </Button>
              )}
            </Box>
          ),
        },
      });

      entries.push({
        key: "consent",
        step: {
          title: t("guide-consent-title"),
          hint: t("guide-consent-hint"),
          // The database refuses the capture without both, so gating here only
          // tells her earlier than the error would.
          canAdvance: consents.audio && consents.ai,
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
              <Button
                variant="contained"
                color="primary"
                onClick={() => void collectConsents()}
                disabled={consentBusy}
                className="self-start"
              >
                {t("guide-consent-cta")}
              </Button>
            </Box>
          ),
        },
      });

      entries.push({
        key: "record",
        step: {
          title: t("guide-record-title"),
          hint: t("guide-record-hint"),
          // Advancing with a capture still in flight would hand the review step
          // an anamnesis the pipeline has not written yet.
          canAdvance: recordingReady && !recordingBlocking,
          content:
            patient && consultationId && orgId ? (
              <Box className="flex flex-col gap-3">
                <Alert severity="info">{t("guide-record-minutes")}</Alert>
                <ConsultationRecorder
                  orgId={orgId}
                  patientId={patient.id}
                  consultationId={consultationId}
                  audioConsent={consents.audio}
                  aiConsent={consents.ai}
                  onRequestConsent={() => void collectConsents()}
                  onChanged={() => void onRecordingChanged()}
                />
              </Box>
            ) : (
              <CircularProgress aria-label={t("loading")} />
            ),
        },
      });

      entries.push({
        key: "review",
        step: {
          title: t("guide-review-title"),
          hint: t("guide-review-hint"),
          // Leaving fields flagged is allowed: finalizing them is a separate,
          // named decision on the last step.
          canAdvance: true,
          content: (
            <Box className="flex flex-col gap-3">
              <Alert severity="info">{t("guide-review-body")}</Alert>
              {attention.length === 0 ? (
                <Alert severity="success" icon={<NiCheck size="small" />}>
                  {t("guide-review-clear")}
                </Alert>
              ) : (
                attention.map((item) => (
                  <Box key={`${item.blockKey}.${item.fieldKey}`} className="border-divider rounded-2xl border p-3">
                    <Typography variant="subtitle2" className="mb-1">
                      {t(item.label)}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary mb-2 leading-5">
                      {item.value}
                    </Typography>
                    <Button size="small" variant="outlined" onClick={() => void keepAnswer(item)} disabled={busy}>
                      {t("guide-review-keep")}
                    </Button>
                  </Box>
                ))
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
          content: (
            <Box className="flex flex-col gap-3">
              <Alert severity="info">{t("guide-complaint-example")}</Alert>
              <TextField
                label={t("consultation-chief-complaint")}
                value={complaint}
                onChange={(event) => setComplaint(event.target.value)}
                onBlur={() => {
                  if (complaint.trim().length > 2) void saveComplaint();
                }}
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
          canAdvance: true,
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
        // The freeze happens HERE, in the step, so the trail can continue to
        // the return appointment afterwards instead of ending on it.
        canAdvance: finalized,
        content: (
          <Box className="flex flex-col gap-3">
            {finalized ? (
              <Alert severity="success" icon={<NiCheck size="small" />}>
                {t("guide-finalize-done")}
              </Alert>
            ) : (
              <>
                {/* Finalizing is the one irreversible act in the trail; saying
                    so before the button is the difference between a guided flow
                    and a trap. Corrections after this are addenda. */}
                <Alert severity="warning">{t("guide-finalize-warning")}</Alert>
                <Typography variant="body2" className="text-text-secondary">
                  {t("guide-finalize-summary", { name: patient?.fullName ?? "", complaint: complaint.trim() })}
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => void finalize(pendingWarnings)}
                  disabled={busy || !consultationId}
                  className="self-start"
                >
                  {pendingWarnings.length > 0 ? t("guide-finalize-cta-confirm") : t("guide-finalize-cta")}
                </Button>
              </>
            )}
          </Box>
        ),
      },
    });

    entries.push({
      key: "schedule",
      step: {
        title: t("guide-schedule-title"),
        hint: t("guide-schedule-hint"),
        // Booking a return is genuinely optional — a first consultation does
        // not always have one, and blocking the exit on it would be a trap.
        canAdvance: true,
        content: (
          <Box className="flex flex-col gap-3">
            <Alert severity="info">{t("guide-schedule-body")}</Alert>
            {scheduled && (
              <Alert severity="success" icon={<NiCheck size="small" />}>
                {t("guide-schedule-done")}
              </Alert>
            )}
            {trialFromAgenda && <Alert severity="info">{t("trial-auto-started")}</Alert>}
            <Button
              variant="contained"
              color="primary"
              onClick={() => {
                if (!patient) return;
                setScheduleSeed({ patientId: patient.id, startAt: suggestedReturn().toISOString() });
                setScheduleOpen(true);
              }}
              disabled={!orgId || !patient}
              className="self-start"
            >
              {scheduled ? t("guide-schedule-again") : t("guide-schedule-cta")}
            </Button>
          </Box>
        ),
      },
    });

    return entries;
  }, [
    answers,
    attention,
    busy,
    collectConsents,
    complaint,
    consentBusy,
    consents.ai,
    consents.audio,
    consultationId,
    finalize,
    finalized,
    hasContext,
    keepAnswer,
    onRecordingChanged,
    orgId,
    patient,
    patients,
    pendingWarnings,
    recordingBlocking,
    recordingReady,
    saveComplaint,
    scheduled,
    startTrial,
    suggestedReturn,
    t,
    track,
    trialFromAgenda,
    trialStarted,
  ]);

  // Seed the opening step ONCE, by key: doing it on every render would drag her
  // back the moment a background read lands.
  useEffect(() => {
    if (seeded.current || !firstOpenKey || stepList.length === 0) return;
    const at = stepList.findIndex((entry) => entry.key === firstOpenKey);
    seeded.current = true;
    if (at > 0) setStepIndex(at);
  }, [firstOpenKey, stepList]);

  /** What each milestone says once it is behind her. Silence = no celebration. */
  const CELEBRATION: Partial<Record<StepKey, { title: string; accomplished: string }>> = useMemo(
    () => ({
      patient: { title: t("celebrate-patient-title"), accomplished: t("celebrate-patient-body") },
      record: { title: t("celebrate-record-title"), accomplished: t("celebrate-record-body") },
      finalize: { title: t("celebrate-finalize-title"), accomplished: t("celebrate-finalize-body") },
    }),
    [t],
  );

  const requestIndex = (next: number) => {
    const current = stepList[stepIndex]?.key;
    // Only forward moves celebrate, and only the first time across.
    if (next > stepIndex && current && CELEBRATION[current] && !celebrated.current.has(current)) {
      celebrated.current.add(current);
      setCelebrating({ from: current, to: next });
      return;
    }
    setStepIndex(next);
  };

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
            if (started) setTrialFromAgenda(true);
          }}
        />
      )}
    </Box>
  );
}
