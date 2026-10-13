"use client";

import { useTranslations } from "next-intl";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import { TILE_TONE } from "@/components/product/tile-tone";
import NiCompass from "@/icons/nexture/ni-compass";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiLock from "@/icons/nexture/ni-lock";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPen from "@/icons/nexture/ni-pen";
import { cn } from "@/lib/utils";

/** Paired with the card's heading, so the section has an accessible name. */
const TITLE_ID = "first-consultation-guide-title";

/**
 * The first consultation, explained WHERE it happens.
 *
 * The onboarding used to walk a real consultation right after sign-up: open
 * it, type the complaint, finalize. A user test showed the professional lost
 * there — she was at her desk with nobody to attend, being asked to start a
 * consultation. The guidance was right and the moment was wrong.
 *
 * So the same three things are said here instead, on the consultation screen,
 * the first time she opens one — with the patient in front of her and the real
 * controls on the page: what the chief complaint is for, that a blank field is
 * "não informado" and never a negative (PRD §10.5), and that finalizing freezes
 * the record (PRD §8.5). It goes away by itself once a first record is closed,
 * and she can dismiss it earlier.
 *
 * NOT numbered, on purpose: the screen already numbers its own steps
 * (ConsultationStepHeader), and a second 1-2-3 beside them is how two things
 * end up both labelled "2". These are three facts about the screen, each led by
 * the icon of the place it talks about.
 *
 * It conducts nothing and gates nothing — the screen's own "next action" in the
 * context bar keeps doing that. This is orientation for a first visit.
 */
export default function FirstConsultationGuide({
  withRecording,
  onStart,
  onDismiss,
}: {
  /** She can record this consultation: the second point then covers both ways of filling the chart. */
  withRecording: boolean;
  /** Takes her to the chief complaint — the one field every path starts with. */
  onStart: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("product");

  const points = [
    {
      key: "complaint",
      icon: <NiPen size="medium" />,
      title: t("first-consultation-guide-complaint-title"),
      body: t("first-consultation-guide-complaint-body"),
    },
    {
      key: "chart",
      icon: withRecording ? <NiMicrophone size="medium" /> : <NiDocumentFull size="medium" />,
      title: t(withRecording ? "first-consultation-guide-record-title" : "first-consultation-guide-chart-title"),
      body: t(withRecording ? "first-consultation-guide-record-body" : "first-consultation-guide-chart-body"),
    },
    {
      key: "finalize",
      icon: <NiLock size="medium" />,
      title: t("first-consultation-guide-finalize-title"),
      body: t("first-consultation-guide-finalize-body"),
    },
  ];

  return (
    <Card component="section" aria-labelledby={TITLE_ID}>
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-row items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex h-10 w-10 flex-none items-center justify-center rounded-2xl",
              TILE_TONE.primary.bg,
              TILE_TONE.primary.text,
            )}
          >
            <NiCompass size="medium" />
          </span>
          <Box className="min-w-0 flex-1">
            <Typography variant="h6" component="h2" id={TITLE_ID} className="mb-0">
              {t("first-consultation-guide-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary leading-5">
              {t("first-consultation-guide-hint")}
            </Typography>
          </Box>
        </Box>

        <Box component="ul" className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {points.map((point) => (
            <Box component="li" key={point.key} className="flex flex-row items-start gap-2.5">
              <span aria-hidden className="text-primary mt-0.5 inline-flex flex-none">
                {point.icon}
              </span>
              <Box className="min-w-0">
                <Typography variant="subtitle2" component="h3" className="mb-0">
                  {point.title}
                </Typography>
                <Typography variant="body2" className="text-text-secondary leading-5">
                  {point.body}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Button variant="contained" color="primary" size="small" onClick={onStart}>
            {t("first-consultation-guide-start")}
          </Button>
          <Button variant="text" color="grey" size="small" onClick={onDismiss}>
            {t("first-consultation-guide-dismiss")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
