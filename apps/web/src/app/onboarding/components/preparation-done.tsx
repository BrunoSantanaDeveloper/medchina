"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import type { MicCheckResult } from "@/components/product/mic-check";
import { useOnboardingStatus } from "@/components/product/onboarding-status-provider";
import { DEFAULTS } from "@/config";
import NiAi from "@/icons/nexture/ni-ai";
import NiCheck from "@/icons/nexture/ni-check";
import { PRACTICE_MODALITIES, type PracticeModality } from "@/lib/practice-context";
import { getProductAction } from "@/lib/product-actions";

const AGENDA_HREF = getProductAction("agenda").href;
const LIBRARY_HREF = getProductAction("library").href;

export type PreparationSummary = {
  modalities: PracticeModality[];
  other: string[];
  fertility: boolean;
  title: string;
  registration: string;
  /** What she decided on the recording step, or null when she has not been through it. */
  recording: "ai" | "manual" | null;
  mic: MicCheckResult | null;
  scheduled: boolean;
};

/**
 * The end of the preparation — and the opposite of "tudo pronto!".
 *
 * A setup that ends by congratulating her and dropping her on an empty home has
 * only moved the "e agora?" one screen later. So this screen does two things:
 *
 *  - it plays back what each answer became (a setup she cannot see is a form
 *    she filled in), in her own words;
 *  - it says what happens NEXT and where: on the day of the appointment, the
 *    consultation screen takes over. The first consultation is not something to
 *    do now, alone at a desk — that was the old guide, and it is where the user
 *    test lost the professional.
 *
 * The library is offered because it is the one place the AI can be seen
 * working today, with no patient, no consent and no recording — and it already
 * answers through the modalities she has just declared.
 */
export default function PreparationDone({
  summary,
  trialStartedNow,
  onReview,
}: {
  summary: PreparationSummary;
  /** Booking the appointment started the Pro trial in this very session. */
  trialStartedNow: boolean;
  onReview: () => void;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const { status, allowance } = useOnboardingStatus();
  // Asking the library is an operational action too (0084): say so before the click.
  const libraryStartsTrial = !trialStartedNow && status?.kind === "free" && allowance?.trialAvailable === true;

  const rows = useMemo(() => {
    const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    const practised = [
      ...PRACTICE_MODALITIES.filter((slug) => summary.modalities.includes(slug)).map((slug) =>
        t(`practice-modality-${slug}`),
      ),
      ...summary.other,
      ...(summary.fertility ? [t("practice-area-fertility")] : []),
    ];
    const signature = [summary.title, summary.registration].filter(Boolean);
    return [
      {
        key: "scope",
        label: t("prep-scope-title"),
        value: practised.length > 0 ? list.format(practised) : t("prep-done-scope-none"),
      },
      {
        key: "signature",
        label: t("prep-signature-title"),
        value: signature.length > 0 ? signature.join(" · ") : t("prep-done-signature-none"),
      },
      {
        key: "recording",
        label: t("prep-recording-title"),
        value:
          summary.recording === "manual"
            ? t("prep-done-recording-manual")
            : summary.mic === "heard"
              ? t("prep-done-recording-tested")
              : summary.recording === "ai"
                ? t("prep-done-recording-ready")
                : t("prep-done-recording-none"),
      },
      {
        key: "next",
        label: t("prep-next-title"),
        value: summary.scheduled ? t("prep-done-next-scheduled") : t("prep-done-next-none"),
      },
    ];
  }, [locale, summary, t]);

  return (
    <Box className="flex w-full max-w-2xl flex-col gap-5 py-4">
      <Box className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="bg-accent-1/15 text-accent-1 flex h-14 w-14 items-center justify-center rounded-2xl"
        >
          <NiCheck size="large" />
        </span>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("prep-done-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary max-w-lg leading-6">
          {t(summary.scheduled ? "prep-done-body-scheduled" : "prep-done-body")}
        </Typography>
      </Box>

      {/* Booking can START the Pro trial (migration 0084); a trial that begins
          in silence is a clock she never saw. */}
      {trialStartedNow && <Alert severity="info">{t("trial-auto-started")}</Alert>}

      <Card component="section" aria-label={t("prep-done-recap-label")}>
        <CardContent>
          <Box component="dl" className="m-0 flex flex-col gap-3">
            {rows.map((row) => (
              <Box key={row.key} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                <Typography variant="body2" component="dt" className="text-text-secondary flex-none sm:w-48">
                  {row.label}
                </Typography>
                <Typography variant="body1" component="dd" className="text-text-primary m-0 min-w-0 break-words">
                  {row.value}
                </Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Box className="flex flex-row flex-wrap items-center justify-center gap-2">
        <Button LinkComponent={Link} href={DEFAULTS.appRoot} variant="contained" color="primary">
          {t("prep-done-cta")}
        </Button>
        {summary.scheduled && (
          <Button LinkComponent={Link} href={AGENDA_HREF} variant="outlined" color="grey">
            {t("home-open-agenda")}
          </Button>
        )}
        <Button variant="text" color="grey" onClick={onReview}>
          {t("prep-done-review")}
        </Button>
      </Box>

      {/* The button sits under the text, not in the Alert's `action` slot: that
          slot is a column beside the message, and at 390px a label this long
          pushed it past the edge of the screen. */}
      <Alert severity="info" icon={<NiAi size="medium" />} className="neutral bg-background-paper/60!">
        <Box className="flex flex-col items-start gap-2">
          <Box>
            <Typography variant="subtitle2" component="p" className="mb-0">
              {t("getting-library-title")}
            </Typography>
            <Typography variant="body2" className="leading-5">
              {t("getting-library-body")}
              {libraryStartsTrial ? ` ${t("prep-done-library-trial")}` : ""}
            </Typography>
          </Box>
          <Button LinkComponent={Link} href={LIBRARY_HREF} variant="outlined" color="primary" size="small">
            {t("getting-library-cta")}
          </Button>
        </Box>
      </Alert>
    </Box>
  );
}
