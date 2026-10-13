"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import PracticeModalitiesField from "@/components/product/fields/practice-modalities-field";
import {
  describeTimeZone,
  PRACTICE_MODALITIES,
  type PracticeModality,
  type TimezoneProposal,
  type TimezoneSource,
} from "@/lib/practice-context";
import { createClient } from "@flyee/auth/client";

export type ScopeValues = {
  modalities: PracticeModality[];
  other: string[];
  fertility: boolean;
  timezone: string;
};

type ScopeResult = {
  ok?: boolean;
  code?: string;
  timezone?: string;
  practice_modalities?: string[];
  practice_modalities_other?: string[];
  practice_areas?: string[];
};

/**
 * Step 1 of the preparation: how she works.
 *
 * The job on this step: tell the product what she practises, so what it
 * prepares for her is hers — and see, before leaving the screen, what each
 * answer changed. A setup question with no visible consequence is a form; the
 * "o que isso muda" panel is what makes it a configuration.
 *
 * This is also where the practice timezone is confirmed, WITHOUT a field: the
 * page already compared the browser's clock with the stored one (`timezone`).
 * Only when the two differ does a question appear — and it asks "what time is
 * it at your practice?", with two clocks to pick from, because that is a
 * question she can answer at a glance and "America/Manaus" is not.
 */
export default function ScopeStep({
  formId,
  orgId,
  initial,
  timezone,
  onSubmittingChange,
  onCompleted,
}: {
  /** The wizard's primary button submits this form (`form={formId}`). */
  formId: string;
  orgId: string;
  initial: Omit<ScopeValues, "timezone">;
  timezone: TimezoneProposal;
  onSubmittingChange: (submitting: boolean) => void;
  onCompleted: (values: ScopeValues) => void;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const questionId = useId();
  const [modalities, setModalities] = useState(initial.modalities);
  const [other, setOther] = useState(initial.other);
  const [fertility, setFertility] = useState(initial.fertility);
  // The browser's zone comes first and starts selected: it is where she is
  // sitting, which is nearly always where she works.
  const [chosenZone, setChosenZone] = useState(timezone.kind === "ask" ? timezone.browser : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One reading of the clock for both options, so they never disagree by a minute.
  const [now] = useState(() => new Date());

  useEffect(() => {
    onSubmittingChange(submitting);
  }, [onSubmittingChange, submitting]);

  const list = useMemo(() => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }), [locale]);

  const effects = useMemo(() => {
    const lines: { key: string; text: string }[] = [];
    // Declaring all five says the same as declaring none: nothing is narrowed.
    if (modalities.length > 0 && modalities.length < PRACTICE_MODALITIES.length) {
      lines.push({
        key: "modalities",
        text: t("prep-scope-effect-modalities", {
          modalities: list.format(modalities.map((slug) => t(`practice-modality-${slug}`))),
        }),
      });
    } else {
      lines.push({ key: "all", text: t("prep-scope-effect-all") });
    }
    if (other.length > 0) {
      lines.push({ key: "other", text: t("prep-scope-effect-other", { names: list.format(other) }) });
    }
    if (fertility) lines.push({ key: "fertility", text: t("prep-scope-effect-fertility") });
    return lines;
  }, [fertility, list, modalities, other, t]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const zone = timezone.kind === "ask" ? chosenZone : timezone.timezone;
    const source: TimezoneSource =
      timezone.kind === "ask" ? "chosen" : timezone.kind === "kept" ? "kept" : timezone.source;
    const stored = timezone.kind === "ask" ? timezone.stored : timezone.timezone;

    const save = (targetZone: string, targetSource: TimezoneSource) =>
      createClient().rpc("complete_practice_scope", {
        target_org: orgId,
        target_timezone: targetZone,
        target_modalities: modalities,
        target_modalities_other: other,
        target_areas: fertility ? ["fertility"] : [],
        target_timezone_source: targetSource,
      });

    try {
      let { data, error: rpcError } = await save(zone, source);
      let result = data as ScopeResult | null;
      // A zone the browser knows and the database does not (a retired alias):
      // the stored one stands, and the audit says it was the default.
      if (!rpcError && result?.code === "invalid_timezone" && zone !== stored) {
        ({ data, error: rpcError } = await save(stored, "default"));
        result = data as ScopeResult | null;
      }
      if (rpcError || !result?.ok) {
        setError(
          result?.code === "invalid_modality_other"
            ? t("prep-scope-error-other")
            : result?.code === "not_authorized"
              ? t("prep-scope-error-not-authorized")
              : t("prep-save-error"),
        );
        return;
      }
      onCompleted({
        modalities: PRACTICE_MODALITIES.filter((slug) => (result?.practice_modalities ?? []).includes(slug)),
        other: result.practice_modalities_other ?? other,
        fertility: (result.practice_areas ?? []).includes("fertility"),
        timezone: result.timezone ?? zone,
      });
    } catch {
      setError(t("prep-save-error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box component="form" id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <PracticeModalitiesField
        value={modalities}
        onChange={setModalities}
        other={other}
        onOtherChange={setOther}
        disabled={submitting}
        label={t("prep-scope-modalities-label")}
      />

      <Box className="flex flex-col gap-1">
        <Typography variant="subtitle2" component="h3" className="mb-0">
          {t("practice-areas-title")}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={fertility}
              disabled={submitting}
              onChange={(event) => setFertility(event.target.checked)}
            />
          }
          label={t("practice-area-fertility")}
        />
      </Box>

      {timezone.kind === "ask" && (
        <FormControl>
          <FormLabel id={questionId} className="text-text-primary font-semibold">
            {t("prep-timezone-question")}
          </FormLabel>
          <RadioGroup
            aria-labelledby={questionId}
            value={chosenZone}
            onChange={(event) => setChosenZone(event.target.value)}
          >
            {[timezone.browser, timezone.stored].map((zone, index) => {
              const { clock, name } = describeTimeZone(zone, locale, now);
              return (
                <FormControlLabel
                  key={zone}
                  value={zone}
                  disabled={submitting}
                  control={<Radio />}
                  label={t(index === 0 ? "prep-timezone-option-here" : "prep-timezone-option", { clock, name })}
                />
              );
            })}
          </RadioGroup>
          <FormHelperText className="mx-0">{t("prep-timezone-help")}</FormHelperText>
        </FormControl>
      )}

      <Alert severity="info" className="neutral bg-background-paper/60!" role="status">
        <Typography variant="subtitle2" component="p" className="mb-1">
          {t("prep-scope-effect-title")}
        </Typography>
        <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
          {effects.map((line) => (
            <Typography key={line.key} component="li" variant="body2" className="leading-5">
              {line.text}
            </Typography>
          ))}
        </Box>
      </Alert>

      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
