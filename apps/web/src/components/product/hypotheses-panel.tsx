"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

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
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";

import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

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
};

type PriorPattern = { pattern: string; startedAt: string };

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
  canReason,
  isFinalized,
}: {
  consultationId: string;
  patientId: string;
  canReason: boolean;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const [hypotheses, setHypotheses] = useState<Hypothesis[] | null>(null);
  const [prior, setPrior] = useState<PriorPattern[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ hypothesis: Hypothesis; mode: "reject" | "edit" } | null>(null);
  const [note, setNote] = useState("");
  const [pattern, setPattern] = useState("");
  const [showPrior, setShowPrior] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setHypotheses([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("consultation_hypotheses")
      .select(
        "id, pattern, rationale, correspondence, supporting_signs, contradicting_signs, missing_data, sources, limitation, status, review_note, model",
      )
      .eq("consultation_id", consultationId)
      .order("created_at", { ascending: true });

    setHypotheses(
      (data ?? []).map((row) => ({
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
      })),
    );

    // "Comparar hipótese atual com padrões anteriores" (PRD §10.8): what this
    // patient's earlier consultations settled on — only what SHE accepted,
    // never a draft the AI once proposed.
    const { data: earlier } = await supabase
      .from("consultation_hypotheses")
      .select("pattern, status, consultations!inner(patient_id, started_at, id)")
      .eq("consultations.patient_id", patientId)
      .in("status", ["accepted", "edited"])
      .neq("consultation_id", consultationId)
      .order("created_at", { ascending: false })
      .limit(5);
    setPrior(
      (earlier ?? []).map((row) => {
        const consultation = row.consultations as unknown as { started_at: string };
        return { pattern: row.pattern as string, startedAt: consultation?.started_at };
      }),
    );
  }, [consultationId, patientId]);

  useEffect(() => {
    load();
  }, [load]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/hypotheses`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          body.error === "reasoning_not_available"
            ? t("hypotheses-not-available")
            : body.error === "nothing_recorded"
              ? t("hypotheses-nothing-recorded")
              : (body.error ?? t("hypotheses-error")),
        );
        return;
      }
      await load();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("hypotheses-error"));
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
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase
      .from("consultation_hypotheses")
      .update({
        status,
        ...(changes?.pattern ? { pattern: changes.pattern } : {}),
        review_note: changes?.note ?? null,
        reviewed_by: user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", hypothesis.id);
    setReviewing(null);
    setNote("");
    setPattern("");
    await load();
  };

  if (!hypotheses) return null;

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

  const hasAny = hypotheses.length > 0;

  // Without the Pro layer there is nothing to show and nothing to sell here —
  // the consultation screen is not a place to advertise (PRD §7.4).
  if (!canReason && !hasAny) return null;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiClipboard size="medium" className="text-primary" />
          {/* The heading is prescribed by PRD §10.8, word for word. */}
          <Typography variant="h6" component="h2">
            {t("hypotheses-title")}
          </Typography>
        </Box>

        {error && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        )}

        {!hasAny ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("hypotheses-empty")}
            </Typography>
            {!isFinalized && canReason && (
              <Button variant="contained" color="primary" onClick={prepare} disabled={busy} className="self-start">
                {busy ? <CircularProgress size={18} /> : t("hypotheses-prepare")}
              </Button>
            )}
          </>
        ) : (
          <>
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

                {!isFinalized && hypothesis.status === "draft" && (
                  <Box className="flex flex-row flex-wrap gap-2">
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      onClick={() => review(hypothesis, "accepted")}
                    >
                      {t("hypotheses-accept")}
                    </Button>
                    {/* Editing makes the reading hers, not the model's (PRD §10.10). */}
                    <Button
                      size="small"
                      variant="outlined"
                      color="grey"
                      onClick={() => {
                        setReviewing({ hypothesis, mode: "edit" });
                        setPattern(hypothesis.pattern);
                        setNote("");
                      }}
                    >
                      {t("hypotheses-edit")}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="grey"
                      onClick={() => {
                        setReviewing({ hypothesis, mode: "reject" });
                        setNote("");
                      }}
                    >
                      {t("hypotheses-reject")}
                    </Button>
                  </Box>
                )}
              </Box>
            ))}

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

            {!isFinalized && canReason && (
              <Button variant="outlined" color="primary" onClick={prepare} disabled={busy} className="self-start">
                {busy ? <CircularProgress size={18} /> : t("hypotheses-reprepare")}
              </Button>
            )}
          </>
        )}

        {/* PRD §10.11 — mandatory, verbatim, always visible. */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("hypotheses-disclaimer")}
        </Typography>
      </CardContent>

      <Dialog open={Boolean(reviewing)} onClose={() => setReviewing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {reviewing?.mode === "edit" ? t("hypotheses-edit-title") : t("hypotheses-reject-title")}
        </DialogTitle>
        <DialogContent className="flex flex-col gap-3">
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
            disabled={reviewing?.mode === "edit" && pattern.trim().length === 0}
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
