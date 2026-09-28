"use client";

import { Box, Skeleton } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import type { RailItem } from "@/lib/consultation-rail";
import type { JourneyStepKey } from "@flyee/clinical";

/**
 * The consultation's steps, drawn from the journey the screen already derives.
 *
 * It is a MAP, not a gate. Every item scrolls the single page — nothing mounts,
 * nothing unmounts, nothing is disabled. A blocked step stays clickable on
 * purpose: on this screen the place of the block is the place of the fix, and
 * the reason the server gave is written next to the control that resolves it,
 * never here (a reason separated from its control is the regression a wizard
 * would introduce).
 *
 * Deliberately absent: "step 3 of 8". The visible list grows and shrinks while
 * she works — the Pro entitlement, a plan that appears, a prescription she
 * starts — so a total would be a number about nothing.
 *
 * States say only what is known: `loading` reserves space with a skeleton and
 * `unknown` asserts nothing, the same rule the gates follow.
 */

const TONE: Record<string, string> = {
  done: "border-transparent bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
  in_progress: "border-primary/40 bg-primary/10 text-primary-dark dark:text-primary-light",
  stale: "border-transparent bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
  blocked: "border-grey-100 bg-transparent text-text-secondary",
  available: "border-grey-100 bg-background-paper text-text-primary",
  unknown: "border-grey-100 bg-transparent text-text-secondary",
};

export interface RailEntry extends RailItem {
  /** Translated name of the step. */
  label: string;
  /** Translated state, read by screen readers and shown as a tooltip title. */
  stateLabel: string;
}

export default function ConsultationStepRail({
  entries,
  active,
  label,
  onJump,
}: {
  entries: RailEntry[];
  /** The step on screen, or null when the page cannot say without guessing. */
  active: JourneyStepKey | null;
  /** Accessible name of the rail ("Etapas da consulta"). */
  label: string;
  onJump: (key: JourneyStepKey) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <Box
      component="nav"
      aria-label={label}
      // Scrolls sideways on a phone instead of wrapping into three rows above
      // the record; wraps on a wide screen, where there is room.
      // `w-full` + `max-w-full`: without a definite width the flex row measures
      // itself by its content, and the page — not the rail — was what scrolled
      // sideways on a phone.
      // `relative`: a scroll container only clips what it POSITIONS. An
      // absolutely positioned descendant of a static container escapes it — a
      // visually-hidden label inside this row scrolled the whole PAGE sideways
      // on a phone, 263px of it, while the rail itself sat neatly at 358.
      className="relative flex w-full max-w-full flex-row flex-nowrap items-center gap-1.5 overflow-x-auto py-0.5 md:flex-wrap md:overflow-visible"
    >
      {entries.map((entry) =>
        entry.state === "loading" ? (
          <Skeleton key={entry.key} variant="rounded" width={104} height={30} className="flex-none rounded-full!" />
        ) : (
          <button
            key={entry.key}
            type="button"
            onClick={() => onJump(entry.key)}
            aria-current={active === entry.key ? "step" : undefined}
            // The state travels in the accessible NAME instead of a hidden
            // span: it is never colour alone, and nothing is positioned inside
            // a scroller to leak the page width.
            aria-label={`${entry.label}: ${entry.stateLabel}`}
            title={`${entry.label} · ${entry.stateLabel}`}
            className={`min-h-9 flex-none rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              TONE[entry.state] ?? TONE.available
            } ${active === entry.key ? "ring-primary/40 ring-2" : ""}`}
          >
            <span className="flex flex-row items-center gap-1.5">
              {entry.state === "done" ? (
                <NiCheck size="tiny" aria-hidden />
              ) : entry.number === undefined ? null : (
                <span aria-hidden className="tabular-nums opacity-70">
                  {entry.number}
                </span>
              )}
              <span>{entry.label}</span>
              {entry.count !== undefined && entry.count > 0 && (
                <span aria-hidden className="rounded-full border border-current px-1 text-xs leading-4 tabular-nums">
                  {entry.count}
                </span>
              )}
            </span>
          </button>
        ),
      )}
    </Box>
  );
}
