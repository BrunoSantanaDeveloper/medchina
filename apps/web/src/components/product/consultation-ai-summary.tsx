"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";

import NiAi from "@/icons/nexture/ni-ai";
import { cn } from "@/lib/utils";

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
  initialSummary,
  onApply,
  readOnly = false,
}: {
  consultationId: string;
  /** Pro entitlement — generating the suggestion is a Pro capability. */
  canGenerate: boolean;
  initialSummary: string | null;
  /** Copy the draft into her Resumo clínico field. */
  onApply: (text: string) => void;
  /** Finalized consultation: show the stored summary, no generate/apply. */
  readOnly?: boolean;
}) {
  const t = useTranslations("product");
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

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
        const code = body.error?.code;
        setErrorKey(
          code === "reasoning_not_available"
            ? "ai-summary-pro"
            : code === "ai_consent_required"
              ? "ai-summary-consent"
              : code === "nothing_recorded"
                ? "ai-summary-nothing"
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
          <Box className="flex flex-row flex-wrap gap-2">
            <Button variant="contained" color="primary" size="small" onClick={() => onApply(summary)}>
              {t("ai-summary-apply")}
            </Button>
            {canGenerate && (
              <Button variant="text" color="grey" size="small" onClick={() => void generate()} disabled={busy}>
                {busy ? <CircularProgress size={16} /> : t("ai-summary-refresh")}
              </Button>
            )}
          </Box>
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
            disabled={busy}
          >
            {busy ? <CircularProgress size={16} /> : t("ai-summary-generate")}
          </Button>
        </>
      )}

      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
        {t("ai-summary-disclaimer")}
      </Typography>
    </Box>
  );
}
