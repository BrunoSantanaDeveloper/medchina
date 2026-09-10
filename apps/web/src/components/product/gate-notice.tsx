"use client";

import { useTranslations } from "next-intl";

import { Box, Button, Typography } from "@mui/material";

import type { JourneyGate } from "@flyee/clinical";

/**
 * Why an action cannot run right now — in words, under the control it disables,
 * with the way out when there is one.
 *
 * Three rules this component exists to keep:
 *  - a disabled control ALWAYS states its reason as visible text (link it with
 *    `aria-describedby={id}`); a tooltip does not exist on touch;
 *  - a fact that is still LOADING says nothing at all — it is not a block, and
 *    claiming one would be as dishonest as claiming availability;
 *  - a fact that FAILED to load is "unknown": an offer to try again, never a
 *    block and never an empty state (PRD §10.5 — absence is not a negative).
 */
export default function GateNotice({
  gate,
  id,
  onRequestConsent,
  onRetry,
}: {
  gate: JourneyGate;
  /** Id referenced by the control's `aria-describedby`. */
  id: string;
  /** Opens the consent dialog in this screen when the block is the AI consent. */
  onRequestConsent?: () => void;
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
    <Box className="flex flex-col items-start gap-1">
      <Typography id={id} variant="body2" className="text-text-secondary text-xs leading-5">
        {t(`journey-reason-${gate.reason}`)}
      </Typography>
      {gate.reason === "ai_consent_required" && onRequestConsent && (
        <Button size="small" variant="outlined" color="primary" onClick={onRequestConsent}>
          {t("journey-next-action-consent")}
        </Button>
      )}
    </Box>
  );
}
