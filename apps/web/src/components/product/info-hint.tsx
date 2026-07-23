"use client";

import { IconButton, Tooltip } from "@mui/material";

import NiInfoSquare from "@/icons/nexture/ni-info-square";

/**
 * Secondary, OPERATIONAL detail behind an info affordance (how upload
 * confirmation works, what a plan tier includes) — the kind of note a
 * practitioner rereads once and then never needs again.
 *
 * Deliberately NOT for clinical safety text. A tooltip is invisible until
 * hovered and hover does not exist on the tablets used in a consulting room,
 * so anything that must actually be READ (the PRD §10.11 reasoning
 * disclaimer, "this plan is a draft, not a prescription") stays on the page.
 *
 * `enterTouchDelay={0}` so a tap opens it on touch instead of requiring a long
 * press, and the trigger is a real button so it is keyboard reachable.
 */
export default function InfoHint({ label }: { label: string }) {
  return (
    <Tooltip title={label} enterTouchDelay={0} leaveTouchDelay={6000} arrow>
      <IconButton size="tiny" color="grey" aria-label={label} className="self-start">
        <NiInfoSquare size="tiny" />
      </IconButton>
    </Tooltip>
  );
}
