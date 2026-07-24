"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Typography } from "@mui/material";

import ActivationProgress from "@/components/product/activation-progress";
import PracticeContextForm from "@/components/product/practice-context-form";
import NiAi from "@/icons/nexture/ni-ai";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiUsers from "@/icons/nexture/ni-users";
import { type ExperienceFacts, getExperienceFacts, getOnboardingFlowKey } from "@/lib/onboarding";
import { getProductAction } from "@/lib/product-actions";
import { trackProductEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { type FlowKey, getOnboardingState, type OnboardingStateRow, selectTrack } from "@flyee/onboarding";

type Track = NonNullable<OnboardingStateRow["selectedTrack"]>;
type LiveStep = { key: string; title: string; body: string; href?: string; done: boolean };

/**
 * The scripted "demo" track was removed. It promised "see the result before
 * registering anyone" but only DESCRIBED that result across three text slides,
 * and its own footer pointed at the clinical library as "the real demo" — while
 * a progress ring rewarded reading three paragraphs. Seeing the AI with no
 * patient, consent or recording is now the library's job, invited below.
 */
type OfferedTrack = Extract<Track, "manual" | "ai">;

const TRACKS: { key: OfferedTrack; icon: React.ReactNode; total: number }[] = [
  { key: "manual", icon: <NiUsers size="medium" />, total: 3 },
  { key: "ai", icon: <NiMicrophone size="medium" />, total: 5 },
];
const isTrack = (value: string | null): value is OfferedTrack => value === "manual" || value === "ai";
/** Rows stored before the demo track was removed still say "demo". */
const normalizeTrack = (value: Track | null): OfferedTrack => (value === "ai" ? "ai" : "manual");
const NEW_PATIENT_HREF = getProductAction("new-patient").href;
const PATIENTS_HREF = getProductAction("patients").href;

function StepList({ steps, actionLabel }: { steps: LiveStep[]; actionLabel: string }) {
  const t = useTranslations("product");
  const nextKey = steps.find((step) => !step.done)?.key;
  return (
    <Box className="flex flex-col gap-2">
      {steps.map((step) => (
        <Box
          key={step.key}
          className={cn(
            "border-divider flex items-start gap-3 rounded-2xl border p-3",
            step.key === nextKey && "border-primary/40 bg-primary/5",
          )}
        >
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
            {step.key === nextKey && <Chip size="small" color="primary" label={t("getting-next-step")} />}
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
  const [selected, setSelected] = useState<OfferedTrack>(isTrack(requestedTrack) ? requestedTrack : "manual");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
        const initial = isTrack(requestedTrack) ? requestedTrack : normalizeTrack(onboarding.selectedTrack);
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

  const manualDone = facts
    ? [facts.hasPracticeContext, facts.hasPatient, facts.hasFinalizedConsultation].filter(Boolean).length
    : 0;
  const aiDone = facts
    ? [
        facts.hasPracticeContext,
        facts.hasPatient,
        facts.hasAiReadyConsent,
        facts.hasRecording,
        facts.hasReadyRecording,
      ].filter(Boolean).length
    : 0;
  const progress: Record<OfferedTrack, number> = { manual: manualDone, ai: aiDone };

  const choose = async (track: OfferedTrack) => {
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
              key: "practice-context",
              title: t("getting-manual-context"),
              body: t("getting-manual-context-body"),
              done: facts.hasPracticeContext,
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
              key: "practice-context",
              title: t("getting-ai-context"),
              body: t("getting-ai-context-body"),
              done: facts.hasPracticeContext,
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

  if (loading)
    return (
      <Box className="flex min-h-72 items-center justify-center">
        <CircularProgress aria-label={t("loading")} />
      </Box>
    );
  if (error || !state || !facts) return <Alert severity="error">{t("getting-load-error")}</Alert>;

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

          {!facts.hasPracticeContext && (
            <Box id="practice-context" className="scroll-mt-28">
              <PracticeContextForm
                onCompleted={() =>
                  setFacts((current) => (current ? { ...current, hasPracticeContext: true } : current))
                }
              />
            </Box>
          )}
          {selected === "manual" && <StepList steps={manualSteps} actionLabel={t("getting-open-step")} />}
          {selected === "ai" && <StepList steps={aiSteps} actionLabel={t("getting-open-step")} />}
        </CardContent>
      </Card>

      {/* Seeing the AI work without spending a patient, a consent and a
          recording is a real need — it was what the scripted demo claimed to
          serve. The library actually does it: real answers, cited sources, no
          clinical data required. So it is invited here on its own, for either
          track, instead of being buried under a simulation. */}
      <Card component="section">
        <CardContent className="flex flex-col gap-2">
          <Box className="flex items-center gap-3">
            <span className="bg-primary/10 text-primary flex h-10 w-10 flex-none items-center justify-center rounded-xl">
              <NiAi size="medium" />
            </span>
            <Typography variant="h6" component="h2" className="mb-0">
              {t("getting-library-title")}
            </Typography>
          </Box>
          <Typography variant="body2" className="text-text-secondary max-w-2xl">
            {t("getting-library-body")}
          </Typography>
          <Button
            LinkComponent={Link}
            href="/biblioteca"
            variant="contained"
            color="primary"
            className="self-start"
            startIcon={<NiAi size="tiny" />}
          >
            {t("getting-library-cta")}
          </Button>
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
