"use client";

import NextStep from "./components/next-step";
import { usePreparationExit } from "./components/onboarding-shell";
import PreparationDone from "./components/preparation-done";
import RecordingStep from "./components/recording-step";
import ScopeStep, { type ScopeValues } from "./components/scope-step";
import SignatureStep, { type SignatureValues } from "./components/signature-step";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";

import type { MicCheckResult } from "@/components/product/mic-check";
import { useOnboardingStatus } from "@/components/product/onboarding-status-provider";
import ScheduleDialog from "@/components/product/schedule-dialog";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import { DEFAULTS } from "@/config";
import {
  firstPendingPrepStep,
  getExperienceFacts,
  getOnboardingFlowKey,
  isOnboardingEnabled,
  isPrepStepKey,
  markPreparationStarted,
  markPrepStep,
  PREP_STEP_KEYS,
  type PrepStepKey,
  prepStepsDone,
} from "@/lib/onboarding";
import {
  browserTimeZone,
  normalizeOtherModalities,
  PRACTICE_MODALITIES,
  type PracticeModality,
  proposeTimezone,
} from "@/lib/practice-context";
import { ensureProTrial } from "@/lib/pro-trial";
import { trackPreparationEvent, trackProductEvent } from "@/lib/product-events";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { type FlowKey, getOnboardingState, selectTrack } from "@flyee/onboarding";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The preparation of the practice: what a professional can settle alone, at her
 * desk, minutes after signing up — so that nothing is left to discover with a
 * patient in the room.
 *
 * WHAT THIS REPLACED. The onboarding used to open on "como você quer começar?"
 * and then walk a real consultation: register a patient, type a complaint,
 * finalize. A user test showed the professional lost exactly there — she had
 * nobody to attend, and the guide was asking her to start a consultation. A
 * consultation is a moment of USE; the guidance for it now lives on the
 * consultation screen (`FirstConsultationGuide`), the first time she opens one.
 *
 * WHAT IT IS NOW. Four short steps, none of which needs a patient:
 *
 *   1. como você atende  — modalities (the five, plus her own words) and areas;
 *   2. como você assina  — what prints under her name on issued documents;
 *   3. a gravação pronta — microphone, phone capture, the terms the patient reads;
 *   4. o próximo atendimento — the bridge to the first real consultation.
 *
 * Only the first changes what the product does, and only the first writes
 * clinical configuration. The others are hers to skip, and "agora não" is
 * remembered so she is not asked again.
 *
 * WHY IT LIVES HERE. `/onboarding` is a top-level route, outside
 * `app/(dashboard)` — no nav rail, no header, no command palette, by ROUTING
 * rather than by hiding. The shell adds only the commercial badge and the way
 * out.
 *
 * RESUMING. It reopens on the first step that is not behind her, decided from
 * real data wherever the data can tell (`prepStepsDone`). With everything
 * behind her it opens on the summary, never on step 1 as if nothing had
 * happened. `?passo=` opens a specific step — the hub's "abrir".
 */

const SCOPE_FORM_ID = "prep-scope-form";
const SIGNATURE_FORM_ID = "prep-signature-form";

type Account = {
  userId: string;
  flowKey: FlowKey;
  orgId: string;
  practiceName: string;
  displayName: string;
  timezone: string;
  timezoneConfirmed: boolean;
};

type Scope = { modalities: PracticeModality[]; other: string[]; fertility: boolean };

export default function PreparationPage() {
  const t = useTranslations("product");
  const router = useRouter();
  const requestedStep = useSearchParams().get("passo");
  const reportExit = usePreparationExit();
  const { reload: reloadCommercial } = useOnboardingStatus();

  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [scope, setScope] = useState<Scope>({ modalities: [], other: [], fertility: false });
  const [identity, setIdentity] = useState<SignatureValues>({ title: "", registration: "" });
  const [recording, setRecording] = useState<"ai" | "manual" | null>(null);
  const [mic, setMic] = useState<MicCheckResult | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [trialStartedNow, setTrialStartedNow] = useState(false);

  const [stepIndex, setStepIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const read = useCallback(async () => {
    if (!isSupabaseConfigured || !isOnboardingEnabled) {
      router.replace(DEFAULTS.appRoot);
      return;
    }
    setLoad("loading");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/auth/sign-in?next=${encodeURIComponent("/onboarding")}`);
        return;
      }
      const flowKey = await getOnboardingFlowKey(supabase, user.id);
      const [state, facts, profile, membership] = await Promise.all([
        getOnboardingState(supabase, flowKey),
        getExperienceFacts(supabase, user.id),
        supabase
          .from("profiles")
          .select(
            "display_name, practice_modalities, practice_modalities_other, practice_areas, professional_title, professional_registration",
          )
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("memberships")
          .select("org_id, organizations(name, timezone, timezone_confirmed_at)")
          .eq("user_id", user.id)
          .order("created_at")
          .limit(1)
          .maybeSingle(),
      ]);
      // A failed read is not an empty practice: opening the first step blank
      // would invite her to save over answers she never saw.
      if (profile.error || membership.error || !membership.data?.org_id) {
        setLoad("error");
        return;
      }

      const organization = membership.data.organizations as unknown as {
        name?: string | null;
        timezone?: string | null;
        timezone_confirmed_at?: string | null;
      } | null;
      const storedModalities = (profile.data?.practice_modalities as string[] | null) ?? [];

      setAccount({
        userId: user.id,
        flowKey,
        orgId: membership.data.org_id as string,
        practiceName: organization?.name ?? "",
        displayName: profile.data?.display_name ?? "",
        timezone: organization?.timezone || "America/Sao_Paulo",
        timezoneConfirmed: Boolean(organization?.timezone_confirmed_at),
      });
      setScope({
        modalities: PRACTICE_MODALITIES.filter((slug) => storedModalities.includes(slug)),
        other: normalizeOtherModalities(profile.data?.practice_modalities_other as string[] | null),
        fertility: ((profile.data?.practice_areas as string[] | null) ?? []).includes("fertility"),
      });
      setIdentity({
        title: profile.data?.professional_title ?? "",
        registration: profile.data?.professional_registration ?? "",
      });

      const done = prepStepsDone(facts, state);
      setRecording(done.recording ? (state.selectedTrack === "ai" || facts.hasRecording ? "ai" : "manual") : null);
      setScheduled(facts.hasConsultation);

      const pending = firstPendingPrepStep(done);
      if (isPrepStepKey(requestedStep)) {
        setFinished(false);
        setStepIndex(PREP_STEP_KEYS.indexOf(requestedStep));
      } else if (pending) {
        setFinished(false);
        setStepIndex(PREP_STEP_KEYS.indexOf(pending));
      } else {
        // Everything is behind her: show where she stands, not step 1 again.
        setFinished(true);
      }
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [requestedStep, router]);

  useEffect(() => {
    void read();
  }, [read]);

  const currentKey: PrepStepKey = PREP_STEP_KEYS[stepIndex] ?? "scope";

  // The frame's "fazer depois" says from which step she left; the finished
  // screen has its own way out.
  useEffect(() => {
    reportExit({ step: finished || load !== "ready" ? null : currentKey, hidden: finished });
  }, [currentKey, finished, load, reportExit]);

  // One "viewed" per arrival at a step, including coming back to it.
  const viewed = useRef<PrepStepKey | null>(null);
  useEffect(() => {
    if (load !== "ready" || finished) {
      viewed.current = null;
      return;
    }
    if (viewed.current === currentKey) return;
    viewed.current = currentKey;
    trackPreparationEvent("onboarding.step_viewed", currentKey);
  }, [currentKey, finished, load]);

  /**
   * Writes to `onboarding_state`, one at a time. `completeStep` reads the row
   * and writes it back, so two of them in flight would each write the list it
   * read and one flag would be lost. They are remembered in the background —
   * moving on never waits for them, and a failure costs only being asked again.
   */
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const flowKey = account?.flowKey;
  const remember = useCallback(
    (work: (supabase: SupabaseClient, key: FlowKey) => Promise<unknown>) => {
      if (!flowKey) return;
      writes.current = writes.current.then(() => work(createClient(), flowKey)).catch(() => undefined);
    },
    [flowKey],
  );

  const settle = useCallback((key: PrepStepKey, outcome: "completed" | "skipped") => {
    trackPreparationEvent(outcome === "completed" ? "onboarding.step_completed" : "onboarding.step_skipped", key);
    const at = PREP_STEP_KEYS.indexOf(key);
    if (at >= PREP_STEP_KEYS.length - 1) {
      trackPreparationEvent("onboarding.completed");
      setFinished(true);
      return;
    }
    setStepIndex(at + 1);
  }, []);

  const onScopeSaved = useCallback(
    (values: ScopeValues) => {
      setScope({ modalities: values.modalities, other: values.other, fertility: values.fertility });
      setAccount((current) => (current ? { ...current, timezone: values.timezone, timezoneConfirmed: true } : current));
      // The agenda and every date on screen read the practice timezone.
      window.dispatchEvent(new Event("medchina:organization-updated"));
      // Her first real answer: from here on, signing in lands on the app.
      remember((supabase, key) => markPreparationStarted(supabase, key));
      settle("scope", "completed");
    },
    [remember, settle],
  );

  const onSignatureSaved = useCallback(
    (values: SignatureValues | null) => {
      setIdentity(values ?? { title: "", registration: "" });
      remember((supabase, key) => markPrepStep(supabase, key, "signature"));
      settle("signature", values ? "completed" : "skipped");
    },
    [remember, settle],
  );

  const skipSignature = useCallback(() => {
    remember((supabase, key) => markPrepStep(supabase, key, "signature"));
    settle("signature", "skipped");
  }, [remember, settle]);

  /** Both answers lead on: recording is an invitation here, never a fork. */
  const chooseRecording = useCallback(
    (choice: "ai" | "manual") => {
      setRecording(choice);
      trackProductEvent("journey.track_selected", { intent: choice, origin: "onboarding" });
      remember(async (supabase, key) => {
        await selectTrack(supabase, key, choice);
        await markPrepStep(supabase, key, "recording");
      });
      settle("recording", choice === "ai" ? "completed" : "skipped");
      return false;
    },
    [remember, settle],
  );

  const skipNext = useCallback(() => {
    remember((supabase, key) => markPrepStep(supabase, key, "next"));
    settle("next", "skipped");
  }, [remember, settle]);

  const timezone = useMemo(
    () =>
      account
        ? proposeTimezone({
            stored: account.timezone,
            confirmed: account.timezoneConfirmed,
            browser: browserTimeZone(),
          })
        : null,
    [account],
  );

  const steps = useMemo<WizardStep[]>(() => {
    if (!account || !timezone) return [];
    return [
      {
        title: t("prep-scope-title"),
        hint: t("prep-scope-hint"),
        primaryFormId: SCOPE_FORM_ID,
        primaryLabel: t("prep-save-continue"),
        busy: scopeSaving,
        content: (
          <ScopeStep
            formId={SCOPE_FORM_ID}
            orgId={account.orgId}
            initial={scope}
            timezone={timezone}
            onSubmittingChange={setScopeSaving}
            onCompleted={onScopeSaved}
          />
        ),
      },
      {
        title: t("prep-signature-title"),
        hint: t("prep-signature-hint"),
        primaryFormId: SIGNATURE_FORM_ID,
        primaryLabel: t("prep-save-continue"),
        busy: signatureSaving,
        secondary: { label: t("celebration-later"), onClick: skipSignature },
        content: (
          <SignatureStep
            formId={SIGNATURE_FORM_ID}
            userId={account.userId}
            orgId={account.orgId}
            displayName={account.displayName}
            practiceName={account.practiceName}
            initial={identity}
            onSubmittingChange={setSignatureSaving}
            onCompleted={onSignatureSaved}
          />
        ),
      },
      {
        title: t("prep-recording-title"),
        hint: t("prep-recording-hint"),
        primaryLabel: t("continue"),
        onPrimary: () => chooseRecording("ai"),
        secondary: { label: t("prep-recording-manual"), onClick: () => chooseRecording("manual") },
        content: <RecordingStep onMicResult={setMic} />,
      },
      {
        title: t("prep-next-title"),
        hint: t("prep-next-hint"),
        // Booking IS the step; saving the appointment finishes the preparation.
        primaryLabel: t("prep-next-cta"),
        onPrimary: () => {
          setScheduleOpen(true);
          return false;
        },
        secondary: { label: t("prep-next-skip"), onClick: skipNext },
        content: <NextStep />,
      },
    ];
  }, [
    account,
    chooseRecording,
    identity,
    onScopeSaved,
    onSignatureSaved,
    scope,
    scopeSaving,
    signatureSaving,
    skipNext,
    skipSignature,
    t,
    timezone,
  ]);

  if (load === "loading")
    return (
      <Box className="flex min-h-72 w-full items-center justify-center">
        <CircularProgress aria-label={t("loading")} />
      </Box>
    );

  if (load === "error" || !account)
    return (
      <Box className="w-full max-w-2xl">
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void read()}>
              {t("retry")}
            </Button>
          }
        >
          {t("prep-load-error")}
        </Alert>
      </Box>
    );

  if (finished)
    return (
      <PreparationDone
        summary={{ ...scope, ...identity, recording, mic, scheduled }}
        trialStartedNow={trialStartedNow}
        onReview={() => {
          setFinished(false);
          setStepIndex(0);
        }}
      />
    );

  return (
    <Box className="flex w-full max-w-2xl flex-col gap-5">
      <Box className="flex flex-col items-center gap-1 text-center">
        <Typography variant="h1" component="h1" className="mb-0">
          {t("prep-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary leading-6">
          {t("prep-subtitle")}
        </Typography>
      </Box>

      <SetupWizard
        steps={steps}
        index={stepIndex}
        onIndexChange={setStepIndex}
        onComplete={() => settle("next", "skipped")}
      />

      {scheduleOpen && (
        <ScheduleDialog
          open
          orgId={account.orgId}
          timeZone={account.timezone}
          origin="onboarding"
          onClose={() => setScheduleOpen(false)}
          onSaved={async () => {
            setScheduleOpen(false);
            setScheduled(true);
            // Saving an appointment is an operational action and can START the
            // Pro trial (migration 0084). The step said so before the button;
            // the summary says it happened.
            const { started } = await ensureProTrial(account.orgId, "agenda");
            if (started) {
              setTrialStartedNow(true);
              void reloadCommercial();
            }
            remember((supabase, key) => markPrepStep(supabase, key, "next"));
            settle("next", "completed");
          }}
        />
      )}
    </Box>
  );
}
