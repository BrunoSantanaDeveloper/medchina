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
export default function ConsultationStepHeader({
  step,
  icon,
  title,
  hint,
  trailing,
}: {
  step: number;
  icon: ReactNode;
  title: string;
  /** One line: when to use this step and what it builds on. */
  hint?: string;
  /** Optional status affordance rendered at the end of the title row. */
  trailing?: ReactNode;
}) {
  return (
    <Box className="flex flex-col gap-1">
      <Box className="flex flex-row items-center gap-2">
        <Box
          aria-hidden
          className="bg-primary/12 text-primary flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold tabular-nums"
        >
          {step}
        </Box>
        <span aria-hidden className="text-primary inline-flex flex-none">
          {icon}
        </span>
        <Typography variant="h6" component="h2" className="mb-0">
          {title}
        </Typography>
        {trailing}
      </Box>
      {hint && (
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {hint}
        </Typography>
      )}
    </Box>
  );
}
