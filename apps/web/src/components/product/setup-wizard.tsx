"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiCheck from "@/icons/nexture/ni-check";
import { cn } from "@/lib/utils";

export type WizardStep = {
  title: string;
  /** Optional one-line reassurance under the title (progressive disclosure). */
  hint?: string;
  content: React.ReactNode;
  /** Block "next" until the step is valid. Default: true. */
  canAdvance?: boolean;
  /**
   * The step's OWN action, run by the primary button — so a step never shows
   * its action AND a separate "Continuar" (two buttons for one decision, one of
   * them disabled until the other is pressed). Resolve true to move on, false
   * to stay; the step says why. Absent: the button just advances.
   */
  onPrimary?: () => Promise<boolean> | boolean;
  /**
   * Submit this <form> instead. The primary button becomes its submit button
   * (`form={id}`), so validation, Enter-to-submit and field errors stay the
   * form's own; the form's success handler is what moves the flow on.
   */
  primaryFormId?: string;
  /** Label for the primary button here. Defaults to "Continuar"/"Concluir". */
  primaryLabel?: string;
  /**
   * The step moves on by itself when its work completes (e.g. a recording
   * finishing processing), so a primary button would only duplicate that.
   */
  hidePrimary?: boolean;
  /** A second way through beside the primary, e.g. "Agora não". */
  secondary?: { label: string; onClick: () => void };
  /** The step's action is running: the primary shows it and cannot be pressed twice. */
  busy?: boolean;
};

/**
 * Multi-step setup shell (progressive disclosure): one decision per screen
 * with a visible progress rail, so a long setup never feels long. Splitting
 * a form across steps can lift conversion (House: +15%) — friction removed
 * in one place, added in another. The caller owns each step's content and
 * validity; the shell owns navigation, the rail and completion.
 */
export default function SetupWizard({
  steps,
  onComplete,
  completeLabel,
  className,
  initialIndex = 0,
  index: controlledIndex,
  onIndexChange,
}: {
  steps: WizardStep[];
  onComplete: () => void;
  /** Defaults to the translated "Finish". */
  completeLabel?: string;
  className?: string;
  /**
   * Which step to OPEN on — so a flow that can be left and resumed reopens
   * where the person stopped instead of making her walk past everything she
   * already did.
   *
   * Read once, as the name says. The caller derives it from what is already
   * done, and that derivation keeps changing as she works; re-seeding the
   * index from it would yank her out of the step she is reading the moment a
   * background refresh lands. A caller that really must re-seed remounts with
   * a `key`.
   */
  initialIndex?: number;
  /**
   * Controlled mode. Pass BOTH to own the index from outside — the standard
   * React pair, so passing neither keeps the uncontrolled default every current
   * caller relies on.
   *
   * It exists because something can legitimately need to sit BETWEEN two steps:
   * the guided onboarding acknowledges what was just accomplished before it
   * loads the next step, and that acknowledgement is what advances. A wizard
   * that owns its index privately cannot be paused that way.
   */
  index?: number;
  onIndexChange?: (next: number) => void;
}) {
  const t = useTranslations("product");
  const [ownIndex, setOwnIndex] = useState(() => Math.max(0, Math.min(steps.length - 1, initialIndex)));
  const controlled = controlledIndex !== undefined && onIndexChange !== undefined;
  const index = Math.max(0, Math.min(steps.length - 1, controlled ? controlledIndex : ownIndex));
  const setIndex = (next: number) => {
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    if (controlled) onIndexChange(clamped);
    else setOwnIndex(clamped);
  };
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const canAdvance = step.canAdvance ?? true;
  const [acting, setActing] = useState(false);
  const running = acting || Boolean(step.busy);

  const primary = async () => {
    if (running) return;
    if (step.onPrimary) {
      setActing(true);
      let proceed = false;
      try {
        proceed = await step.onPrimary();
      } finally {
        setActing(false);
      }
      if (!proceed) return;
    }
    if (isLast) onComplete();
    else setIndex(index + 1);
  };

  return (
    <Card className={cn("mx-auto w-full max-w-2xl", className)}>
      <CardContent className="flex flex-col gap-6">
        {/* Progress rail — the whole path is visible; the reader sees the end. */}
        <Box className="flex flex-row items-center gap-2">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i < index ? "bg-primary" : i === index ? "bg-primary/60" : "bg-grey-100",
              )}
            />
          ))}
        </Box>

        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("wizardStep", { current: index + 1, total: steps.length })}
          </Typography>
          <Typography variant="h4" component="h2" className="text-text-primary">
            {step.title}
          </Typography>
          {step.hint && (
            <Typography variant="body1" className="text-text-secondary leading-6">
              {step.hint}
            </Typography>
          )}
        </Box>

        <Box>{step.content}</Box>

        <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
          <Button variant="text" color="grey" disabled={index === 0 || running} onClick={() => setIndex(index - 1)}>
            {t("back")}
          </Button>
          <Box className="flex flex-row flex-wrap items-center justify-end gap-2">
            {step.secondary && (
              <Button variant="text" color="grey" onClick={step.secondary.onClick} disabled={running}>
                {step.secondary.label}
              </Button>
            )}
            {!step.hidePrimary &&
              (step.primaryFormId ? (
                <Button
                  type="submit"
                  form={step.primaryFormId}
                  variant="contained"
                  color="primary"
                  disabled={!canAdvance || running}
                  endIcon={isLast ? <NiCheck size="medium" /> : <NiArrowRight size="medium" />}
                >
                  {running
                    ? t("saving")
                    : (step.primaryLabel ?? (isLast ? (completeLabel ?? t("finish")) : t("continue")))}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!canAdvance || running}
                  endIcon={isLast ? <NiCheck size="medium" /> : <NiArrowRight size="medium" />}
                  onClick={() => void primary()}
                >
                  {running
                    ? t("saving")
                    : (step.primaryLabel ?? (isLast ? (completeLabel ?? t("finish")) : t("continue")))}
                </Button>
              ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
