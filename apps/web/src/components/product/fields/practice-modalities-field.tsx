"use client";

import { useTranslations } from "next-intl";

import { Autocomplete, TextField } from "@mui/material";

import { PRACTICE_MODALITIES, type PracticeModality } from "@/lib/practice-context";

/**
 * The five modalities this professional treats with — the declaration that
 * bounds what the therapeutic plan may propose (PRD §10.9) and what the
 * library assistant prioritises.
 *
 * A controlled field with no form library of its own, because its two callers
 * disagree about that: the onboarding form runs on Formik, the settings card
 * on plain state. Keeping the option list, the labels and the empty-state copy
 * in ONE place is the point — a second copy would drift from
 * `PRACTICE_MODALITIES`, and the slugs are validated in SQL.
 */
export default function PracticeModalitiesField({
  value,
  onChange,
  onBlur,
  disabled,
  label,
  helperText,
}: {
  value: PracticeModality[];
  onChange: (value: PracticeModality[]) => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Overrides the default label (onboarding and settings word it differently). */
  label?: string;
  helperText?: string;
}) {
  const t = useTranslations("product");

  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      disabled={disabled}
      options={[...PRACTICE_MODALITIES]}
      value={value}
      getOptionLabel={(option) => t(`practice-modality-${option}`)}
      onChange={(_, next) => onChange(next as PracticeModality[])}
      onBlur={onBlur}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? t("practice-context-modalities")}
          helperText={helperText ?? t("practice-context-modalities-help")}
        />
      )}
    />
  );
}
