"use client";

import { useTranslations } from "next-intl";

import { Box, Button, Typography } from "@mui/material";

import type { JourneyGate } from "@flyee/clinical";

/**
 * Why an action cannot run right now — in words, under the control it disables.
 *
 * Three rules this component exists to keep:
 *  - a disabled control ALWAYS states its reason as visible text (link it with
 *    `aria-describedby={id}`); a tooltip does not exist on touch;
 *  - a fact that is still LOADING says nothing at all — it is not a block, and
 *    claiming one would be as dishonest as claiming availability;
 *  - a fact that FAILED to load is "unknown": an offer to try again, never a
 *    block and never an empty state (PRD §10.5 — absence is not a negative).
 *
 * It deliberately offers NO consent button. Registering a consent lives in ONE
 * place — the "Consentimentos" control at the top of the consultation — because
 * the same button repeated on every card read as noise and made it unclear
 * which one to press; the reason sentence points there instead.
 */
export default function GateNotice({
  gate,
  id,
  onRetry,
}: {
  gate: JourneyGate;
  /** Id referenced by the control's `aria-describedby`. */
  id: string;
  /** Re-fetches whatever failed, when the state is "unknown". */
  onRetry?: () => void;
}) {
  const t = useTranslations("product");

  if (gate.state === "unknown") {
    return (
      <Box className="flex flex-row flex-wrap items-center gap-1">
        <Typography id={id} variant="body2" className="text-text-secondary text-xs leading-5">
          {t("journey-reason-unknown")}
        </Typography>
        {onRetry && (
          <Button size="small" className="px-1!" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </Box>
    );
  }

  if (gate.state !== "blocked") return null;

  return (
    <Typography id={id} variant="body2" className="text-text-secondary text-xs leading-5">
      {t(`journey-reason-${gate.reason}`)}
    </Typography>
  );
}
