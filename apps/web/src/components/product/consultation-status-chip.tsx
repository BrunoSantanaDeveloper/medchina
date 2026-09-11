"use client";

import { useTranslations } from "next-intl";

import { Button } from "@mui/material";

/**
 * A consultation's lifecycle stage as the template's own badge idiom — a tiny
 * pastel button — instead of a colored dot. The dot carried meaning by color
 * alone, which fails the "color is never the only indicator" rule; this names
 * the stage and tints it, so it reads the same way for everyone.
 */
const STATUS_CHIP: Record<string, { color: "primary" | "accent-1" | "accent-2" | "accent-3" | "grey"; label: string }> =
  {
    scheduled: { color: "accent-2", label: "agenda-status-scheduled" },
    in_progress: { color: "primary", label: "agenda-status-in-progress" },
    awaiting_review: { color: "accent-3", label: "agenda-status-awaiting" },
    draft: { color: "grey", label: "agenda-status-draft" },
    finalized: { color: "accent-1", label: "agenda-status-finalized" },
  };

export default function ConsultationStatusChip({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("product");
  const chip = STATUS_CHIP[status];
  if (!chip) return null;
  // A span in the button's clothes: it is a label, not a control, so it takes
  // no focus and announces as plain text — the stage still reaches everyone.
  return (
    <Button
      component="span"
      role="presentation"
      tabIndex={-1}
      size="tiny"
      variant="pastel"
      color={chip.color}
      className={["pointer-events-none flex-none", className].filter(Boolean).join(" ")}
    >
      {t(chip.label)}
    </Button>
  );
}
