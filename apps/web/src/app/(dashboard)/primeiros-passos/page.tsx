"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Grid, Typography } from "@mui/material";

import ActivationProgress from "@/components/product/activation-progress";
import { QuickActionTile } from "@/components/product/home-tiles";
import InfoHint from "@/components/product/info-hint";
import SectionTitle from "@/components/product/section-title";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiAi from "@/icons/nexture/ni-ai";
import NiBook from "@/icons/nexture/ni-book";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiPen from "@/icons/nexture/ni-pen";
import {
  buildFirstConsultationSteps,
  buildPreparationSteps,
  type ExperienceFacts,
  followsRecordingPath,
  getExperienceFacts,
  getOnboardingFlowKey,
  ONBOARDING_ROUTE,
  prepStepsDone,
} from "@/lib/onboarding";
import { getProductAction } from "@/lib/product-actions";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { getOnboardingState, type OnboardingStateRow, type OnboardingStep } from "@flyee/onboarding";

const LIBRARY_HREF = getProductAction("library").href;
const IMPORT_HREF = getProductAction("import-patients").href;
const PROTOCOLS_HREF = getProductAction("protocols").href;
const ACERVO_HREF = getProductAction("acervo").href;

/** One list of steps, each read from real state. The next open one is marked. */
function StepList({ steps, actionLabel }: { steps: OnboardingStep[]; actionLabel: string }) {
  const t = useTranslations("product");
  const nextKey = steps.find((step) => !step.done)?.key;
  return (
    <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
      {steps.map((step) => (
        <Box
          component="li"
          key={step.key}
          // `relative`: the visually hidden state label below is absolutely
          // positioned and must stay anchored to its own row.
          className={cn(
            "border-grey-100 relative flex items-start gap-3 rounded-2xl border p-3",
            step.key === nextKey && "border-primary/40 bg-primary/5",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border",
              step.done ? "border-primary bg-primary text-white" : "border-grey-200 text-transparent",
            )}
          >
            <NiCheck size="small" />
          </span>
          <Box className="min-w-0 flex-1">
            <Typography variant="subtitle2" component="h3" className={cn("mb-0", step.done && "text-text-secondary")}>
              {t(step.title)}
              {/* The check mark is decorative; the state is also said in words. */}
              {step.done && <span className="sr-only"> — {t("getting-step-done")}</span>}
            </Typography>
            {step.key === nextKey && <Chip size="small" color="primary" label={t("getting-next-step")} />}
            {step.description && (
              <Typography variant="body2" className="text-text-secondary">
                {t(step.description)}
              </Typography>
            )}
          </Box>
          {step.href && (
            <Button
              LinkComponent={Link}
              href={step.href}
              variant="text"
              size="small"
              color={step.done ? "grey" : "primary"}
              endIcon={<NiChevronRightSmall size="small" />}
              className="flex-none"
              aria-label={`${step.done ? t("getting-review-step") : actionLabel}: ${t(step.title)}`}
            >
              {step.done ? t("getting-review-step") : actionLabel}
            </Button>
          )}
        </Box>
      ))}
    </Box>
  );
}

const countDone = (steps: OnboardingStep[]) => steps.filter((step) => step.done).length;

/**
 * The persistent hub: the whole path from sign-up to the first finalized
 * record, in two halves that are different kinds of thing.
 *
 *  - **Preparo do consultório** — what she can do alone. Each row opens that
 *    step of `/onboarding`, done or not: a preparation she can review is a
 *    configuration; one she can only do once is a form.
 *  - **Primeiro atendimento** — what needs a patient. The rows point at where
 *    it happens; the guidance itself lives on the consultation screen.
 *
 * It used to offer two tabbed "tracks" (manual / IA) with their own step lists
 * and totals, while the home checklist counted a third way and the guide a
 * fourth. All of them now read the same facts through `lib/onboarding.ts`, so a
 * step is done here exactly when it is done everywhere. Recording is not a
 * track any more — it is three extra rows for whoever said she records.
 */
export default function GettingStartedPage() {
  const t = useTranslations("product");
  const [state, setState] = useState<OnboardingStateRow | null>(null);
  const [facts, setFacts] = useState<ExperienceFacts | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    if (!isSupabaseConfigured) {
      setStatus("error");
      return;
    }
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus("error");
        return;
      }
      const key = await getOnboardingFlowKey(supabase, user.id);
      const [experience, onboarding] = await Promise.all([
        getExperienceFacts(supabase, user.id),
        getOnboardingState(supabase, key),
      ]);
      setFacts(experience);
      setState(onboarding);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading")
    return (
      <Box className="flex min-h-72 items-center justify-center">
        <CircularProgress aria-label={t("loading")} />
      </Box>
    );
  if (status === "error" || !state || !facts)
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void load()}>
            {t("retry")}
          </Button>
        }
      >
        {t("getting-load-error")}
      </Alert>
    );

  const preparation = buildPreparationSteps(prepStepsDone(facts, state));
  const recordingPath = followsRecordingPath(state, facts);
  const consultation = buildFirstConsultationSteps(facts, recordingPath);

  return (
    <Box className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* The page opens on its title; what it is for sits behind the "i"
          beside it (the owner, 2026-11-09), read once and not on every visit. */}
      <Box className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Typography variant="h1" component="h1" className="mb-0">
          {t("getting-title")}
        </Typography>
        <InfoHint label={t("getting-subtitle")} placement="bottom-start" className="self-center" />
      </Box>

      <Card component="section" aria-labelledby="getting-preparation-title">
        <CardContent className="flex flex-col gap-5">
          <SectionTitle
            id="getting-preparation-title"
            variant="h4"
            title={t("getting-preparation-title")}
            description={t("getting-preparation-body")}
            action={
              <ActivationProgress
                done={countDone(preparation)}
                total={preparation.length}
                size={42}
                label={t("getting-progress", { done: countDone(preparation), total: preparation.length })}
                className="flex-none"
              />
            }
          />
          <StepList steps={preparation} actionLabel={t("getting-open-step")} />
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="getting-consultation-title">
        <CardContent className="flex flex-col gap-5">
          <SectionTitle
            id="getting-consultation-title"
            variant="h4"
            title={t("getting-consultation-title")}
            description={t("getting-consultation-body")}
            action={
              <ActivationProgress
                done={countDone(consultation)}
                total={consultation.length}
                size={42}
                label={t("getting-progress", { done: countDone(consultation), total: consultation.length })}
                className="flex-none"
              />
            }
          />
          <StepList steps={consultation} actionLabel={t("getting-open-step")} />
          {/* Recording is not a separate track: it is three more rows for
              whoever records. Someone who has not said so is shown the way to
              say it, not a list of steps that may not be hers. */}
          {!recordingPath && (
            <Box className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
              <Typography variant="body2" className="text-text-secondary">
                {t("getting-recording-invite")}
              </Typography>
              <Button
                LinkComponent={Link}
                href={`${ONBOARDING_ROUTE}?passo=recording`}
                variant="text"
                size="small"
                endIcon={<NiChevronRightSmall size="small" />}
              >
                {t("getting-recording-invite-cta")}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Seeing the AI work without spending a patient, a consent and a
          recording is a real need. The library actually does it: real answers,
          cited sources, no clinical data required — and it already answers
          through the modalities she declared in the preparation. */}
      <Card component="section">
        <CardContent className="flex flex-col gap-2">
          <Box className="flex items-center gap-3">
            <span
              aria-hidden
              className={cn(
                "flex h-10 w-10 flex-none items-center justify-center rounded-2xl",
                TILE_TONE.primary.bg,
                TILE_TONE.primary.text,
              )}
            >
              <NiAi size="medium" />
            </span>
            <SectionTitle variant="h6" title={t("getting-library-title")} description={t("getting-library-body")} />
          </Box>
          <Button
            LinkComponent={Link}
            href={LIBRARY_HREF}
            variant="contained"
            color="primary"
            className="self-start"
            startIcon={<NiAi size="tiny" />}
          >
            {t("getting-library-cta")}
          </Button>
        </CardContent>
      </Card>

      {/* The deeper personalisation is WORK, not configuration — an afternoon
          with a spreadsheet, a protocol written out. It is invited here, where
          she comes when she has time, and kept out of the onboarding. */}
      <Box component="section" className="flex flex-col gap-3" aria-labelledby="getting-more-title">
        <Typography variant="h5" component="h2" id="getting-more-title" className="mb-0">
          {t("getting-more-title")}
        </Typography>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <QuickActionTile
              href={IMPORT_HREF}
              icon={<NiDownloadCloud size="large" />}
              tone="accent-2"
              title={t("getting-more-import")}
              description={t("getting-more-import-body")}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <QuickActionTile
              href={PROTOCOLS_HREF}
              icon={<NiPen size="large" />}
              tone="accent-1"
              title={t("getting-more-protocols")}
              description={t("getting-more-protocols-body")}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <QuickActionTile
              href={ACERVO_HREF}
              icon={<NiBook size="large" />}
              tone="accent-4"
              title={t("getting-more-acervo")}
              description={t("getting-more-acervo-body")}
            />
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
