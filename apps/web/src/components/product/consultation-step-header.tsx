"use client";

import type { ReactNode } from "react";

import { Box, Typography } from "@mui/material";

/**
 * Shared header for the consultation's assistant cards (record → interpret →
 * plan). A numbered badge + icon gives each card a place in a RECOMMENDED
 * sequence, and the hint states how it depends on the previous step — so the
 * three cards read as one ordered flow instead of three independent controls.
 * The order is a suggestion, never a hard gate (a plan can still be manual).
 */
/**
 * Where this step stands, derived from DATA (see `deriveConsultationJourney` in
 * `@flyee/clinical`). "stale" is amber, never red: work that needs redoing is
 * not a clinical risk, and red is reserved for risk and failure.
 */
const STATUS_TONE: Record<"done" | "in_progress" | "stale", string> = {
  done: "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
  in_progress: "bg-grey-100 text-text-secondary",
  stale: "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
};

export default function ConsultationStepHeader({
  step,
  icon,
  title,
  hint,
  status,
  statusLabel,
  trailing,
}: {
  /**
   * Position in the recommended sequence. OMIT it for a card that is not a step
   * of the clinical reasoning — supporting material, or an upgrade prompt.
   * Numbering something that is not a step is how two cards ended up both
   * labelled "2", turning the guidance into noise.
   */
  step?: number;
  icon: ReactNode;
  title: string;
  /** One line: when to use this step and what it builds on. */
  hint?: string;
  /**
   * Concluded / under way / outdated. Shown as a chip so the card says where it
   * stands without her having to open it — the reason a step is BLOCKED is not
   * shown here: it belongs next to the control that is disabled.
   */
  status?: "done" | "in_progress" | "stale";
  /** Translated label for `status` (the component holds no copy). */
  statusLabel?: string;
  /** Optional status affordance rendered at the end of the title row. */
  trailing?: ReactNode;
}) {
  return (
    <Box className="flex flex-col gap-1">
      <Box className="flex flex-row items-center gap-2">
        {step !== undefined && (
          <Box
            aria-hidden
            className="bg-primary/12 text-primary flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold tabular-nums"
          >
            {step}
          </Box>
        )}
        <span aria-hidden className="text-primary inline-flex flex-none">
          {icon}
        </span>
        <Typography variant="h6" component="h2" className="mb-0">
          {title}
        </Typography>
        {(status && statusLabel) || trailing ? (
          <Box className="ml-auto flex flex-row items-center gap-1.5">
            {status && statusLabel && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>
                {statusLabel}
              </span>
            )}
            {trailing}
          </Box>
        ) : null}
      </Box>
      {hint && (
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {hint}
        </Typography>
      )}
    </Box>
  );
}
