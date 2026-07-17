"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Typography,
} from "@mui/material";

import ActivationProgress from "@/components/product/activation-progress";
import NiAi from "@/icons/nexture/ni-ai";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiUsers from "@/icons/nexture/ni-users";
import { type ExperienceFacts, getExperienceFacts, getOnboardingFlowKey } from "@/lib/onboarding";
import { getProductAction } from "@/lib/product-actions";
import { trackProductEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import {
  completeStep,
  type FlowKey,
  getOnboardingState,
  type OnboardingStateRow,
  resetSteps,
  selectTrack,
} from "@flyee/onboarding";

type Track = NonNullable<OnboardingStateRow["selectedTrack"]>;
type LiveStep = { key: string; title: string; body: string; href?: string; done: boolean };

const TRACKS: { key: Track; icon: React.ReactNode; total: number }[] = [
  { key: "manual", icon: <NiUsers size="medium" />, total: 3 },
  { key: "demo", icon: <NiAi size="medium" />, total: 3 },
  { key: "ai", icon: <NiMicrophone size="medium" />, total: 5 },
];
const DEMO_STEPS = ["demo:capture", "demo:organize", "demo:review"];
const isTrack = (value: string | null): value is Track => value === "manual" || value === "demo" || value === "ai";
const SETTINGS_HREF = getProductAction("settings").href;
const NEW_PATIENT_HREF = getProductAction("new-patient").href;
const PATIENTS_HREF = getProductAction("patients").href;

function StepList({ steps, actionLabel }: { steps: LiveStep[]; actionLabel: string }) {
  return (
    <Box className="flex flex-col gap-2">
      {steps.map((step) => (
        <Box key={step.key} className="border-divider flex items-start gap-3 rounded-2xl border p-3">
          <span
            className={cn(
              "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border",
              step.done ? "border-primary bg-primary text-white" : "border-grey-200 text-transparent",
            )}
          >
            <NiCheck size="small" />
          </span>
          <Box className="min-w-0 flex-1">
            <Typography variant="subtitle2" className={cn(step.done && "text-text-secondary")}>
              {step.title}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {step.body}
            </Typography>
          </Box>
          {!step.done && step.href && (
            <Button
              LinkComponent={Link}
              href={step.href}
              variant="text"
              size="small"
              endIcon={<NiChevronRightSmall size="small" />}
              className="flex-none"
            >
              {actionLabel}
            </Button>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** Persistent self-serve hub: every path remains available after onboarding. */
export default function GettingStartedPage() {
  const t = useTranslations("product");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTrack = searchParams.get("trilha");
  const [flowKey, setFlowKey] = useState<FlowKey | null>(null);
  const [state, setState] = useState<OnboardingStateRow | null>(null);
  const [facts, setFacts] = useState<ExperienceFacts | null>(null);
  const [selected, setSelected] = useState<Track>(isTrack(requestedTrack) ? requestedTrack : "manual");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!isSupabaseConfigured) {
        if (active) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      try {
        const key = await getOnboardingFlowKey(supabase, user.id);
        const experience = await getExperienceFacts(supabase, user.id);
        const onboarding = await getOnboardingState(supabase, key);
        if (!active) return;
        const initial = isTrack(requestedTrack) ? requestedTrack : (onboarding.selectedTrack ?? "manual");
        setFlowKey(key);
        setFacts(experience);
        setState(onboarding);
        setSelected(initial);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [requestedTrack]);

  const demoDone = state ? DEMO_STEPS.filter((step) => state.completedSteps.includes(step)).length : 0;
  const manualDone = facts
    ? [facts.hasProfileName, facts.hasPatient, facts.hasFinalizedConsultation].filter(Boolean).length
    : 0;
  const aiDone = facts
    ? [
        facts.hasProfileName,
        facts.hasPatient,
        facts.hasAiReadyConsent,
        facts.hasRecording,
        facts.hasReadyRecording,
      ].filter(Boolean).length
    : 0;
  const progress: Record<Track, number> = { manual: manualDone, demo: demoDone, ai: aiDone };

  const choose = async (track: Track) => {
    trackProductEvent(state?.selectedTrack === track ? "journey.track_reentered" : "journey.track_selected", {
      intent: track,
      origin: "getting_started",
    });
    setSelected(track);
    router.replace(`/primeiros-passos?trilha=${track}`, { scroll: false });
    if (flowKey) {
      await selectTrack(createClient(), flowKey, track);
      setState((current) => (current ? { ...current, selectedTrack: track } : current));
    }
  };

  const manualSteps = useMemo<LiveStep[]>(
    () =>
      facts
        ? [
            {
              key: "profile",
              title: t("getting-manual-profile"),
              body: t("getting-manual-profile-body"),
              href: SETTINGS_HREF,
              done: facts.hasProfileName,
            },
            {
              key: "patient",
              title: t("getting-manual-patient"),
              body: t("getting-manual-patient-body"),
              href: NEW_PATIENT_HREF,
              done: facts.hasPatient,
            },
            {
              key: "consultation",
              title: t("getting-manual-consultation"),
              body: t("getting-manual-consultation-body"),
              href: PATIENTS_HREF,
              done: facts.hasFinalizedConsultation,
            },
          ]
        : [],
    [facts, t],
  );

  const aiSteps = useMemo<LiveStep[]>(
    () =>
      facts
        ? [
            {
              key: "profile",
              title: t("getting-ai-profile"),
              body: t("getting-ai-profile-body"),
              href: SETTINGS_HREF,
              done: facts.hasProfileName,
            },
            {
              key: "patient",
              title: t("getting-ai-patient"),
              body: t("getting-ai-patient-body"),
              href: NEW_PATIENT_HREF,
              done: facts.hasPatient,
            },
            {
              key: "consent",
              title: t("getting-ai-consent"),
              body: t("getting-ai-consent-body"),
              href: PATIENTS_HREF,
              done: facts.hasAiReadyConsent,
            },
            {
              key: "record",
              title: t("getting-ai-record"),
              body: t("getting-ai-record-body"),
              href: PATIENTS_HREF,
              done: facts.hasRecording,
            },
            {
              key: "review",
              title: t("getting-ai-review"),
              body: t("getting-ai-review-body"),
              href: "/pacientes",
              done: facts.hasReadyRecording,
            },
          ]
        : [],
    [facts, t],
  );

  const advanceDemo = async () => {
    if (!flowKey || !state || busy) return;
    const next = DEMO_STEPS.find((step) => !state.completedSteps.includes(step));
    if (!next) return;
    setBusy(true);
    const result = await completeStep(createClient(), flowKey, next);
    if (result.ok) setState({ ...state, completedSteps: [...state.completedSteps, next] });
    setBusy(false);
  };

  const replayDemo = async () => {
    if (!flowKey || !state || busy) return;
    setBusy(true);
    const result = await resetSteps(createClient(), flowKey, DEMO_STEPS);
    if (result.ok)
      setState({ ...state, completedSteps: state.completedSteps.filter((step) => !DEMO_STEPS.includes(step)) });
    setBusy(false);
  };

  if (loading)
    return (
      <Box className="flex min-h-72 items-center justify-center">
        <CircularProgress />
      </Box>
    );
  if (error || !state || !facts) return <Alert severity="error">{t("getting-load-error")}</Alert>;

  const demoStage = Math.min(demoDone, DEMO_STEPS.length - 1);

  return (
    <Box className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Box className="flex flex-col gap-2">
        <Typography variant="h1" component="h1">
          {t("getting-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary max-w-3xl">
          {t("getting-subtitle")}
        </Typography>
      </Box>

      <Box className="grid gap-3 md:grid-cols-3" role="tablist" aria-label={t("getting-track-label")}>
        {TRACKS.map((track) => (
          <Card
            key={track.key}
            component="button"
            role="tab"
            id={`getting-track-${track.key}`}
            aria-controls="getting-track-panel"
            aria-selected={selected === track.key}
            onClick={() => choose(track.key)}
            className={cn("cursor-pointer text-left", selected === track.key && "outline-primary outline-2")}
          >
            <CardContent className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
                {track.icon}
              </span>
              <Box className="min-w-0 flex-1">
                <Typography variant="subtitle1">{t(`getting-track-${track.key}`)}</Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t(`getting-track-${track.key}-body`)}
                </Typography>
              </Box>
              <ActivationProgress done={progress[track.key]} total={track.total} size={42} />
            </CardContent>
          </Card>
        ))}
      </Box>

      <Card component="section" role="tabpanel" id="getting-track-panel" aria-labelledby={`getting-track-${selected}`}>
        <CardContent className="flex flex-col gap-5">
          <Box className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <Box>
              <Typography variant="h4" component="h2">
                {t(`getting-${selected}-title`)}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t(`getting-${selected}-body`)}
              </Typography>
            </Box>
            <Chip
              color={
                progress[selected] === TRACKS.find((track) => track.key === selected)?.total ? "success" : "default"
              }
              label={t("getting-progress", {
                done: progress[selected],
                total: TRACKS.find((track) => track.key === selected)?.total ?? 0,
              })}
            />
          </Box>

          {selected === "manual" && <StepList steps={manualSteps} actionLabel={t("getting-open-step")} />}
          {selected === "ai" && <StepList steps={aiSteps} actionLabel={t("getting-open-step")} />}
          {selected === "demo" && (
            <Box className="flex flex-col gap-4">
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("getting-demo-fictional")}
              </Alert>
              <LinearProgress variant="determinate" value={(demoDone / DEMO_STEPS.length) * 100} />
              <Box className="bg-grey-25 flex min-h-48 flex-col justify-center gap-3 rounded-3xl p-6">
                <Typography variant="overline">
                  {t("getting-demo-stage", { current: demoDone === 3 ? 3 : demoStage + 1, total: 3 })}
                </Typography>
                <Typography variant="h5" component="h3">
                  {t(`getting-demo-${demoStage + 1}-title`)}
                </Typography>
                <Typography variant="body1" className="text-text-secondary max-w-2xl">
                  {t(`getting-demo-${demoStage + 1}-body`)}
                </Typography>
              </Box>
              <Box className="flex flex-wrap justify-end gap-2">
                {demoDone > 0 && (
                  <Button
                    variant="outlined"
                    color="grey"
                    onClick={replayDemo}
                    disabled={busy}
                    startIcon={<NiRefresh size="small" />}
                  >
                    {t("getting-demo-replay")}
                  </Button>
                )}
                {demoDone < DEMO_STEPS.length && (
                  <Button
                    variant="contained"
                    onClick={advanceDemo}
                    disabled={busy}
                    endIcon={<NiChevronRightSmall size="small" />}
                  >
                    {t(demoDone === 0 ? "getting-demo-start" : "getting-demo-next")}
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      <Box className="flex justify-end">
        <Button LinkComponent={Link} href="/onboarding" variant="text" color="grey">
          {t("getting-change-track")}
        </Button>
      </Box>
    </Box>
  );
}
