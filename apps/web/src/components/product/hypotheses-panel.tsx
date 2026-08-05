"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";

import ConsultationStepHeader from "@/components/product/consultation-step-header";
import DialogHeader from "@/components/product/dialog-header";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import { deriveHypothesesPanelMode } from "@/lib/hypotheses-access";
import { trackCommercialEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type Sign = { text: string; fieldKey?: string };
type Source = { title: string; source: string | null; kind: string };

type Hypothesis = {
  id: string;
  pattern: string;
  rationale: string | null;
  correspondence: "weak" | "moderate" | "strong";
  supportingSigns: Sign[];
  contradictingSigns: Sign[];
  missingData: string[];
  sources: Source[];
  limitation: string | null;
  status: "draft" | "accepted" | "edited" | "rejected";
  reviewNote: string | null;
  model: string | null;
  updatedAt: string;
  staleAt: string | null;
};

type PriorPattern = { pattern: string; startedAt: string };
type HypothesesData = { hypotheses: Hypothesis[]; prior: PriorPattern[] };

/**
 * Disharmony-pattern hypotheses (PRD §10.8) — the Pro reasoning layer.
 *
 * The whole design is an argument against over-trust:
 *  - the mandatory heading and message (PRD §10.8/§10.11) are not fine print;
 *  - "correspondence with the recorded data" is the only strength language
 *    allowed — never confidence, never a percentage;
 *  - contradicting signs and missing data sit at the SAME visual level as the
 *    supporting ones. A hypothesis you can only agree with is a trap;
 *  - a limitation (essential exam data absent) is shown before the pattern is
 *    read, not after;
 *  - she can accept, reject or report every single one (PRD §10.10).
 *
 * Nothing here is red: a hypothesis is not a risk. Red stays reserved for
 * clinical risk and failure (docs/DESIGN.md).
 */
export default function HypothesesPanel({
  consultationId,
  patientId,
  reasoningEntitled,
  canPrepare,
  entitlementLoading,
  entitlementError,
  onRetryEntitlement,
  onDecisionChanged,
  isFinalized,
}: {
  consultationId: string;
  patientId: string;
  reasoningEntitled: boolean;
  canPrepare: boolean;
  entitlementLoading: boolean;
  entitlementError: boolean;
  onRetryEntitlement: () => void;
  /**
   * Fired when a decision lands (accept/edit/reject). The sibling plan panel
   * gates its AI button on whether a hypothesis is accepted, so it re-checks
   * the moment that changes instead of waiting for the next poll.
   */
  onDecisionChanged?: () => void;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const [hypothesesState, setHypothesesState] = useState<RemoteState<HypothesesData, "load_failed">>(() =>
    remoteLoading(),
  );
  const hypothesesRef = useRef<HypothesesData | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ hypothesis: Hypothesis; mode: "reject" | "edit" } | null>(null);
  const [note, setNote] = useState("");
  const [pattern, setPattern] = useState("");
  const [showPrior, setShowPrior] = useState(false);
  /** Set when the last preparation ran WITHOUT the library, because it failed. */
  const [retrievalFailed, setRetrievalFailed] = useState(false);
  // Reviewing patterns is deliberate work over long content — it happens in a
  // dialog so this column stays a summary instead of a scroll.
  const [reviewOpen, setReviewOpen] = useState(false);
  const upgradeViewedRef = useRef(false);

  const load = useCallback(
    async (preservePrevious = true) => {
      if (!preservePrevious) hypothesesRef.current = undefined;
      const previous = preservePrevious ? hypothesesRef.current : undefined;
      setHypothesesState(remoteLoading(previous));
      if (!isSupabaseConfigured) {
        hypothesesRef.current = undefined;
        setHypothesesState(remoteEmpty());
        return;
      }
      const supabase = createClient();
      const { data, error: hypothesesError } = await supabase
        .from("consultation_hypotheses")
        .select(
          "id, pattern, rationale, correspondence, supporting_signs, contradicting_signs, missing_data, sources, limitation, status, review_note, model, updated_at, stale_at",
        )
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: true });

      if (hypothesesError) {
        setHypothesesState(remoteError("load_failed", previous));
        return;
      }

      const hypotheses = (data ?? []).map((row) => ({
        id: row.id,
        pattern: row.pattern,
        rationale: row.rationale,
        correspondence: row.correspondence,
        supportingSigns: (row.supporting_signs ?? []) as Sign[],
        contradictingSigns: (row.contradicting_signs ?? []) as Sign[],
        missingData: (row.missing_data ?? []) as string[],
        sources: (row.sources ?? []) as Source[],
        limitation: row.limitation,
        status: row.status,
        reviewNote: row.review_note,
        model: row.model,
        updatedAt: row.updated_at,
        staleAt: row.stale_at,
      }));

      // "Comparar hipótese atual com padrões anteriores" (PRD §10.8): what this
      // patient's earlier consultations settled on — only what SHE accepted,
      // never a draft the AI once proposed.
      const { data: earlier, error: priorError } = await supabase
        .from("consultation_hypotheses")
        .select("pattern, status, consultations!inner(patient_id, started_at, id)")
        .eq("consultations.patient_id", patientId)
        .in("status", ["accepted", "edited"])
        .neq("consultation_id", consultationId)
        .order("created_at", { ascending: false })
        .limit(5);
      const prior = (earlier ?? []).map((row) => {
        const consultation = row.consultations as unknown as { started_at: string };
        return { pattern: row.pattern as string, startedAt: consultation?.started_at };
      });
      const next = { hypotheses, prior: priorError ? (previous?.prior ?? []) : prior };
      if (priorError) {
        hypothesesRef.current = next;
        setHypothesesState(remoteError("load_failed", next));
        return;
      }
      hypothesesRef.current = hypotheses.length === 0 ? undefined : next;
      setHypothesesState(hypotheses.length === 0 ? remoteEmpty() : remoteSuccess(next));
    },
    [consultationId, patientId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const prepare = async () => {
    if (!canPrepare) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/hypotheses`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "reasoning_not_available"
            ? t("hypotheses-not-available")
            : code === "nothing_recorded"
              ? t("hypotheses-nothing-recorded")
              : t("hypotheses-error"),
        );
        return;
      }
      setRetrievalFailed(Boolean(body?.retrievalFailed));
      await load(true);
    } catch {
      setActionError(t("hypotheses-error"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Her decision on a suggestion (PRD §10.10: reject, edit, report). Editing the
   * pattern makes the reading HERS — same rule as the anamnesis, where touching
   * an AI value flips it to the professional. `reviewed_by` is who decided, so a
   * human judgement is never mistaken for model output.
   */
  const review = async (
    hypothesis: Hypothesis,
    status: "accepted" | "rejected" | "edited",
    changes?: { note?: string; pattern?: string },
  ) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/hypotheses/${hypothesis.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          pattern: changes?.pattern,
          note: changes?.note,
          expectedUpdatedAt: hypothesis.updatedAt,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.error?.code ?? body?.code;
        setActionError(
          code === "hypothesis_stale" || code === "hypothesis_revision_conflict"
            ? t("hypotheses-stale")
            : t("hypotheses-error"),
        );
        return;
      }
      setReviewing(null);
      setNote("");
      setPattern("");
      await load(true);
      onDecisionChanged?.();
    } catch {
      setActionError(t("hypotheses-error"));
    } finally {
      setBusy(false);
    }
  };

  const resource =
    hypothesesState.status === "success"
      ? hypothesesState.data
      : hypothesesState.status === "loading" || hypothesesState.status === "error"
        ? hypothesesState.previous
        : undefined;
  const hypotheses = resource?.hypotheses ?? [];
  const prior = resource?.prior ?? [];
  const initialLoading = hypothesesState.status === "loading" && !resource;
  const loadFailed = hypothesesState.status === "error";
  const refreshing = hypothesesState.status === "loading" && Boolean(resource);
  const hasAny = hypotheses.length > 0;
  const panelMode = deriveHypothesesPanelMode({
    reasoningEntitled,
    canPrepare,
    isFinalized,
    hasHypotheses: hasAny,
  });
  const locked = !initialLoading && !entitlementLoading && !entitlementError && panelMode === "locked" && !loadFailed;

  useEffect(() => {
    if (!locked || upgradeViewedRef.current) return;
    upgradeViewedRef.current = true;
    trackCommercialEvent("upgrade.prompt_viewed", "consultation", "clinical_reasoning");
  }, [locked]);

  if (initialLoading) {
    return <CircularProgress size={24} aria-label={t("loading")} />;
  }

  const correspondenceLabel = (value: Hypothesis["correspondence"]) =>
    ({
      weak: t("hypotheses-match-weak"),
      moderate: t("hypotheses-match-moderate"),
      strong: t("hypotheses-match-strong"),
    })[value];

  const kindLabel = (kind: string) =>
    ({
      traditional: t("hypotheses-kind-traditional"),
      protocol: t("hypotheses-kind-protocol"),
      evidence: t("hypotheses-kind-evidence"),
    })[kind] ?? t("hypotheses-kind-unknown");

  // Without the Pro layer there is nothing to show and nothing to sell here —
  // the consultation screen is not a place to advertise (PRD §7.4).
  if (!entitlementLoading && !entitlementError && panelMode === "hidden" && !loadFailed) return null;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        {/* The title is prescribed by PRD §10.8, word for word. */}
        <ConsultationStepHeader
          step={2}
          icon={<NiClipboard size="medium" />}
          title={locked ? t("hypotheses-locked-title") : t("hypotheses-title")}
          hint={t("hypotheses-step-hint")}
        />

        {loadFailed && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={() => void load(true)}>{t("retry")}</Button>}
          >
            {t("hypotheses-load-error")}
          </Alert>
        )}

        {actionError && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {actionError}
          </Alert>
        )}

        {/* "Nenhuma fonte sustenta esta leitura" and "a biblioteca não foi
            consultada" look the same on the card and mean opposite things. */}
        {retrievalFailed && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("hypotheses-library-unavailable")}
          </Alert>
        )}

        {refreshing && <CircularProgress size={18} aria-label={t("loading")} />}

        {entitlementError && !hasAny ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={onRetryEntitlement}>{t("retry")}</Button>}
          >
            {t("hypotheses-entitlement-error")}
          </Alert>
        ) : entitlementLoading && !hasAny ? (
          <CircularProgress size={18} aria-label={t("loading")} />
        ) : locked ? (
          <Box className="border-primary/25 bg-primary/5 flex flex-col items-start gap-3 rounded-2xl border p-4">
            <Chip size="small" color="primary" label={t("hypotheses-pro-chip")} />
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("hypotheses-locked-body")}
            </Typography>
            <Button
              variant="outlined"
              color="primary"
              fullWidth
              href="/settings/billing?source=consultation&feature=clinical_reasoning"
              LinkComponent={Link}
              onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "consultation", "clinical_reasoning")}
            >
              {t("hypotheses-locked-cta")}
            </Button>
          </Box>
        ) : loadFailed && !resource ? null : !hasAny ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("hypotheses-empty")}
            </Typography>
            {canPrepare && (
              <Button
                variant="contained"
                color="primary"
                fullWidth
                startIcon={busy ? undefined : <NiClipboard size="tiny" />}
                onClick={prepare}
                disabled={busy}
              >
                {busy ? <CircularProgress size={18} /> : t("hypotheses-prepare")}
              </Button>
            )}
          </>
        ) : (
          <>
            {/* The column states WHERE the review stands; the reviewing itself
                happens in the dialog below, which has room for the reasoning. */}
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {hypotheses.some((item) => item.status === "draft")
                ? t("hypotheses-summary-pending", {
                    count: hypotheses.filter((item) => item.status === "draft").length,
                  })
                : t("hypotheses-summary-done")}
            </Typography>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              startIcon={<NiClipboard size="tiny" />}
              onClick={() => setReviewOpen(true)}
            >
              {t("hypotheses-review-open", { count: hypotheses.length })}
            </Button>

            <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} maxWidth="md" fullWidth scroll="paper">
              <DialogHeader
                title={t("hypotheses-title")}
                closeLabel={t("close")}
                onClose={() => setReviewOpen(false)}
              />
              <DialogContent dividers className="flex flex-col gap-3 py-5!">
                {hypotheses.map((hypothesis) => (
                  <Box
                    key={hypothesis.id}
                    className={cn(
                      "border-grey-100 flex flex-col gap-2.5 rounded-2xl border px-3.5 py-3",
                      hypothesis.status === "rejected" && "opacity-60",
                    )}
                  >
                    <Box className="flex flex-row flex-wrap items-center gap-2">
                      <Typography variant="body1" className="text-text-primary font-semibold">
                        {hypothesis.pattern}
                      </Typography>
                      {/* Correspondence with the RECORDED data — never confidence. */}
                      <Chip
                        size="small"
                        variant="outlined"
                        label={correspondenceLabel(hypothesis.correspondence)}
                        className="text-xs"
                      />
                      {hypothesis.status !== "draft" && (
                        <Chip
                          size="small"
                          label={t(`hypotheses-status-${hypothesis.status}`)}
                          className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
                        />
                      )}
                    </Box>

                    {/* Stated BEFORE the pattern is read, not as a footnote. */}
                    {hypothesis.staleAt && (
                      <Alert severity="warning" className="neutral bg-background-paper/60! text-xs">
                        {t("hypotheses-stale")}
                      </Alert>
                    )}
                    {hypothesis.limitation && (
                      <Alert severity="warning" className="neutral bg-background-paper/60! text-xs">
                        {hypothesis.limitation}
                      </Alert>
                    )}

                    {hypothesis.rationale && (
                      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                        {hypothesis.rationale}
                      </Typography>
                    )}

                    <SignList title={t("hypotheses-supporting")} signs={hypothesis.supportingSigns} />
                    {/* Same visual weight as the supporting ones, on purpose. */}
                    <SignList title={t("hypotheses-contradicting")} signs={hypothesis.contradictingSigns} />

                    {hypothesis.missingData.length > 0 && (
                      <Box className="flex flex-col gap-1">
                        <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                          {t("hypotheses-missing")}
                        </Typography>
                        {hypothesis.missingData.map((item, index) => (
                          <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                            · {item}
                          </Typography>
                        ))}
                      </Box>
                    )}

                    <Box className="flex flex-col gap-1">
                      <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                        {t("hypotheses-sources")}
                      </Typography>
                      {hypothesis.sources.length === 0 ? (
                        // Say it plainly rather than leave a confident-looking gap.
                        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                          {t("hypotheses-no-sources")}
                        </Typography>
                      ) : (
                        hypothesis.sources.map((source, index) => (
                          <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                            · {source.title}
                            {source.source ? ` — ${source.source}` : ""} ({kindLabel(source.kind)})
                          </Typography>
                        ))
                      )}
                    </Box>

                    {hypothesis.reviewNote && (
                      <Typography variant="body2" className="text-text-secondary text-xs leading-5 italic">
                        {t("hypotheses-your-note")}: {hypothesis.reviewNote}
                      </Typography>
                    )}

                    {!isFinalized && (
                      <Box className="flex flex-row flex-wrap gap-2">
                        {hypothesis.status !== "accepted" && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            disabled={busy}
                            onClick={() => review(hypothesis, "accepted")}
                          >
                            {t("hypotheses-accept")}
                          </Button>
                        )}
                        {/* Editing makes the reading hers, not the model's (PRD §10.10). */}
                        <Button
                          size="small"
                          variant="outlined"
                          color="grey"
                          disabled={busy}
                          onClick={() => {
                            setReviewing({ hypothesis, mode: "edit" });
                            setPattern(hypothesis.pattern);
                            setNote("");
                          }}
                        >
                          {t("hypotheses-edit")}
                        </Button>
                        {hypothesis.status !== "rejected" && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="grey"
                            disabled={busy}
                            onClick={() => {
                              setReviewing({ hypothesis, mode: "reject" });
                              setNote("");
                            }}
                          >
                            {t("hypotheses-reject")}
                          </Button>
                        )}
                      </Box>
                    )}
                  </Box>
                ))}
                {/* PRD §10.11 travels WITH the reasoning it qualifies. */}
                <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                  {t("hypotheses-disclaimer")}
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button color="grey" onClick={() => setReviewOpen(false)}>
                  {t("close")}
                </Button>
              </DialogActions>
            </Dialog>

            {prior.length > 0 && (
              <Box className="flex flex-col gap-1">
                <Button
                  size="small"
                  color="grey"
                  variant="text"
                  className="self-start"
                  endIcon={<NiChevronDownSmall size="small" />}
                  onClick={() => setShowPrior((value) => !value)}
                >
                  {t("hypotheses-prior", { count: prior.length })}
                </Button>
                {showPrior &&
                  prior.map((item, index) => (
                    <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                      · {item.pattern}
                      {item.startedAt ? ` — ${new Date(item.startedAt).toLocaleDateString()}` : ""}
                    </Typography>
                  ))}
              </Box>
            )}

            {canPrepare && (
              <Button
                variant="outlined"
                color="primary"
                fullWidth
                startIcon={busy ? undefined : <NiClipboard size="tiny" />}
                onClick={prepare}
                disabled={busy}
              >
                {busy ? <CircularProgress size={18} /> : t("hypotheses-reprepare")}
              </Button>
            )}
          </>
        )}

        {/* PRD §10.11 — mandatory and verbatim. Kept here too (not only in the
            review dialog) so the framing is on screen before anything is read. */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("hypotheses-disclaimer")}
        </Typography>
      </CardContent>

      <Dialog open={Boolean(reviewing)} onClose={() => setReviewing(null)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={reviewing?.mode === "edit" ? t("hypotheses-edit-title") : t("hypotheses-reject-title")}
          closeLabel={t("close")}
          onClose={() => setReviewing(null)}
        />
        <DialogContent className="flex flex-col gap-3 py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {reviewing?.mode === "edit" ? t("hypotheses-edit-body") : t("hypotheses-reject-body")}
          </Typography>
          {reviewing?.mode === "edit" && (
            <TextField
              autoFocus
              fullWidth
              label={t("hypotheses-edit-pattern")}
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
          )}
          <TextField
            autoFocus={reviewing?.mode === "reject"}
            multiline
            minRows={3}
            fullWidth
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              reviewing?.mode === "edit" ? t("hypotheses-edit-placeholder") : t("hypotheses-reject-placeholder")
            }
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setReviewing(null)}>
            {t("hypotheses-reject-cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              busy ||
              (reviewing?.mode === "edit" && pattern.trim().length === 0) ||
              (reviewing?.mode === "reject" && note.trim().length === 0)
            }
            onClick={() =>
              reviewing &&
              (reviewing.mode === "edit"
                ? review(reviewing.hypothesis, "edited", { pattern: pattern.trim(), note: note.trim() || undefined })
                : review(reviewing.hypothesis, "rejected", { note: note.trim() || undefined }))
            }
          >
            {reviewing?.mode === "edit" ? t("hypotheses-edit-confirm") : t("hypotheses-reject-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function SignList({ title, signs }: { title: string; signs: Sign[] }) {
  return (
    <Box className="flex flex-col gap-1">
      <Typography variant="body2" className="text-text-primary text-xs font-semibold">
        {title}
      </Typography>
      {signs.length === 0 ? (
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          —
        </Typography>
      ) : (
        signs.map((sign, index) => (
          <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
            · {sign.text}
          </Typography>
        ))
      )}
    </Box>
  );
}
