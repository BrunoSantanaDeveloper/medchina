"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";

import GateNotice from "@/components/product/gate-notice";
import NiAi from "@/icons/nexture/ni-ai";
import { cn } from "@/lib/utils";
import type { JourneyGate } from "@flyee/clinical";

/**
 * The AI-SUGGESTED clinical summary (migration 0071). It is a DRAFT she reviews
 * and APPLIES — it never writes her "Resumo clínico" on its own. Kept current
 * automatically as recordings are processed, and refreshable on demand.
 *
 * Applying copies the draft into her summary field (a deliberate act); the
 * draft itself persists, so nothing is lost.
 */
export default function ConsultationAiSummary({
  consultationId,
  canGenerate,
  gate,
  initialSummary,
  onApply,
  onRequestConsent,
  invalidatesOutputs = false,
  readOnly = false,
}: {
  consultationId: string;
  /** Pro entitlement — generating the suggestion is a Pro capability. */
  canGenerate: boolean;
  /**
   * Whether generating can run now and, if not, why (`deriveConsultationJourney`,
   * mirroring `POST /summary`: Pro, the patient's AI consent, and something
   * recorded to summarise).
   */
  gate?: JourneyGate;
  initialSummary: string | null;
  /** Copy the draft into her Resumo clínico field. */
  onApply: (text: string) => void;
  /** Opens the consent dialog here, instead of navigating out of the consultation. */
  onRequestConsent?: () => void;
  /**
   * Hypotheses or a plan are current: copying this text into her summary edits
   * the chart, which stales them (mark_clinical_outputs_stale). Say so BEFORE
   * the click — that cascade arriving unannounced is the main reason the screen
   * felt like it undid her work.
   */
  invalidatesOutputs?: boolean;
  /** Finalized consultation: show the stored summary, no generate/apply. */
  readOnly?: boolean;
}) {
  const t = useTranslations("product");
  // A gate that is loading is not a block: the control simply waits without
  // claiming a reason it does not have yet.
  const blocked = gate ? gate.state === "blocked" || gate.state === "loading" : false;
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  /**
   * The consultation page polls while a recording is processed, so a summary
   * written by the pipeline arrives as a NEW `initialSummary`. Reading the prop
   * only at mount meant the card kept its empty "generate" state next to an
   * anamnesis that was visibly filling itself in — and she paid for a second AI
   * call to produce what the database already held.
   *
   * Only a value that arrived from outside is adopted: once the card holds
   * something the SERVER did not just send, that is her session and the poll
   * must not overwrite it.
   */
  const lastAdopted = useRef<string | null>(initialSummary);
  useEffect(() => {
    if (initialSummary === lastAdopted.current) return;
    lastAdopted.current = initialSummary;
    // A null from the server means "nothing stored", not "clear the card".
    if (initialSummary) setSummary(initialSummary);
  }, [initialSummary]);

  const generate = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/summary`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { code?: string };
        summary?: string;
      };
      if (!response.ok || !body.ok || typeof body.summary !== "string") {
        // Every cause gets its own sentence. Collapsing them into one
        // "tente novamente" told her to repeat an action that could not
        // succeed, and left the real reason visible only in a server log.
        const code = body.error?.code;
        setErrorKey(
          code === "reasoning_not_available"
            ? "ai-summary-pro"
            : code === "ai_consent_required"
              ? "ai-summary-consent"
              : code === "nothing_recorded"
                ? "ai-summary-nothing"
                : code === "provider_unavailable"
                  ? "ai-summary-provider"
                  : code === "provider_rejected"
                    ? "ai-summary-provider-rejected"
                    : code === "consultation_finalized"
                      ? "ai-summary-finalized"
                      : "ai-summary-error",
        );
        return;
      }
      setSummary(body.summary);
    } catch {
      setErrorKey("ai-summary-error");
    } finally {
      setBusy(false);
    }
  };

  // Read-only (finalized): show the stored summary if there is one, nothing to
  // generate. Otherwise render nothing.
  if (readOnly) {
    if (!summary) return null;
    return (
      <Box className="border-primary/20 bg-primary/5 flex flex-col gap-2 rounded-2xl border p-3">
        <Box className="flex flex-row items-center gap-1.5">
          <NiAi size="small" className="text-primary" aria-hidden />
          <Typography variant="body2" className="text-text-primary font-medium">
            {t("ai-summary-title")}
          </Typography>
        </Box>
        <Typography variant="body2" className="text-text-secondary leading-6 whitespace-pre-line">
          {summary}
        </Typography>
      </Box>
    );
  }

  if (!canGenerate && !summary) return null;

  return (
    <Box className="border-primary/20 bg-primary/5 flex flex-col gap-2 rounded-2xl border p-3">
      <Box className="flex flex-row items-center gap-1.5">
        <NiAi size="small" className="text-primary" aria-hidden />
        <Typography variant="body2" className="text-text-primary font-medium">
          {t("ai-summary-title")}
        </Typography>
      </Box>

      {errorKey && <Alert severity={errorKey === "ai-summary-nothing" ? "info" : "error"}>{t(errorKey)}</Alert>}

      {summary ? (
        <>
          <Typography variant="body2" className="text-text-secondary leading-6 whitespace-pre-line">
            {summary}
          </Typography>
          {/* Copying edits the chart, and editing the chart stales the reasoning
              built on it. Better said here than discovered afterwards. */}
          {invalidatesOutputs && (
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("ai-summary-apply-cost")}
            </Typography>
          )}
          <Box className="flex flex-row flex-wrap gap-2">
            <Button variant="contained" color="primary" size="small" onClick={() => onApply(summary)}>
              {t("ai-summary-apply")}
            </Button>
            {canGenerate && (
              <Button
                variant="text"
                color="grey"
                size="small"
                onClick={() => void generate()}
                disabled={busy || blocked}
                aria-describedby={blocked ? "ai-summary-reason" : undefined}
              >
                {busy ? <CircularProgress size={16} /> : t("ai-summary-refresh")}
              </Button>
            )}
          </Box>
          {gate && <GateNotice gate={gate} id="ai-summary-reason" onRequestConsent={onRequestConsent} />}
        </>
      ) : (
        <>
          <Typography variant="body2" className="text-text-secondary text-xs leading-5">
            {t("ai-summary-empty")}
          </Typography>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            className={cn("self-start")}
            startIcon={busy ? undefined : <NiAi size="tiny" />}
            onClick={() => void generate()}
            disabled={busy || blocked}
            aria-describedby={blocked ? "ai-summary-reason" : undefined}
          >
            {busy ? <CircularProgress size={16} /> : t("ai-summary-generate")}
          </Button>
          {gate && <GateNotice gate={gate} id="ai-summary-reason" onRequestConsent={onRequestConsent} />}
          {busy && (
            <Typography variant="body2" role="status" className="text-text-secondary text-xs leading-5">
              {t("ai-summary-generating")}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
