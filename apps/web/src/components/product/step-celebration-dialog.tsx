"use client";

import { useTranslations } from "next-intl";

import { Box, Button, Dialog, DialogContent, Typography, useMediaQuery } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import NiCheck from "@/icons/nexture/ni-check";

/** Paired with the header's title element, so the dialog HAS an accessible name. */
const TITLE_ID = "step-celebration-title";

/**
 * The beat between two steps of a guided flow: what she just accomplished, and
 * what comes next.
 *
 * WHY THIS IS NOT GAMIFICATION. The product contract forbids points, badges,
 * leaderboards and streaks — "PBL theater bolted on" — and asks instead for
 * completion drive and COMPETENCE FEEDBACK. That is exactly the line this sits
 * on: it awards nothing, counts nothing and ranks no one. It names the real
 * thing that now exists in her records ("o prontuário está fechado e assinado")
 * and what that unlocks. Remove the naming and it becomes a token; keep it and
 * it is the feedback a first-time user needs to know the step actually landed.
 *
 * WHY A MODAL. It is not decoration between steps — it IS the transition: its
 * primary action is what advances the wizard, which is why the wizard has to be
 * driven in controlled mode. A toast could be missed, and a step that advances
 * on its own leaves a beginner unsure whether anything was saved.
 *
 * It always offers a way out (the header's close), because a guided flow whose
 * only control is "continue" is a flow that traps.
 */
export default function StepCelebrationDialog({
  open,
  title,
  accomplished,
  nextTitle,
  nextHint,
  ctaLabel,
  onNext,
  onClose,
}: {
  open: boolean;
  /** What just happened, in her words — not "step 2 complete". */
  title: string;
  /** The concrete thing that now exists because of it. */
  accomplished: string;
  /** Name of the step this loads. */
  nextTitle: string;
  /** One line on what that step is for. */
  nextHint?: string;
  ctaLabel: string;
  /** Advances the flow. */
  onNext: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("product");
  // The repo honours prefers-reduced-motion everywhere motion exists; a dialog
  // that animates in is still motion, and this one appears unprompted.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      transitionDuration={reduceMotion ? 0 : undefined}
      aria-labelledby={TITLE_ID}
    >
      <DialogHeader id={TITLE_ID} title={title} onClose={onClose} closeLabel={t("close")} className="pb-0!" />
      <DialogContent className="flex flex-col gap-4">
        <Box className="flex flex-row items-start gap-3">
          {/* accent-1 is the codebase's "done" tone (see ConsultationStepHeader).
              Green-as-success, never a colour that would read as risk. */}
          <span className="bg-accent-1/15 text-accent-1 flex h-10 w-10 flex-none items-center justify-center rounded-2xl">
            <NiCheck size="medium" />
          </span>
          <Typography variant="body1" className="text-text-primary leading-6">
            {accomplished}
          </Typography>
        </Box>

        <Box className="border-divider flex flex-col gap-1 rounded-2xl border p-3">
          <Typography variant="body2" className="text-text-secondary">
            {t("celebration-next-label")}
          </Typography>
          <Typography variant="subtitle2" className="mb-0">
            {nextTitle}
          </Typography>
          {nextHint && (
            <Typography variant="body2" className="text-text-secondary leading-5">
              {nextHint}
            </Typography>
          )}
        </Box>

        <Box className="flex flex-row flex-wrap items-center gap-2">
          {/* Focused on open, so continuing is Enter and never a hunt. */}
          <Button variant="contained" color="primary" onClick={onNext} autoFocus>
            {ctaLabel}
          </Button>
          <Button variant="text" color="grey" onClick={onClose}>
            {t("celebration-later")}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
