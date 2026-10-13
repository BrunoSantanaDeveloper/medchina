"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Autocomplete, createFilterOptions, TextField } from "@mui/material";

import {
  cleanOtherModality,
  matchPracticeModality,
  normalizeOtherModalities,
  type OtherModalityIssue,
  otherModalityIssue,
  PRACTICE_MODALITIES,
  PRACTICE_MODALITY_OTHER_MAX,
  type PracticeModality,
} from "@/lib/practice-context";

/**
 * What this professional treats with: the five modalities the product knows,
 * plus whatever else she practises, typed in her own words.
 *
 * The two lists are NOT the same kind of answer and are stored apart:
 *
 *  - the five (`value`) bound what the therapeutic plan may propose (PRD §10.9)
 *    and what the library puts first;
 *  - the others (`other`, migration 0119) have no clinical effect. They are how
 *    someone whose practice is not on the list still sees herself here — and
 *    how the platform learns who it is serving.
 *
 * One field holds both because she is answering one question. A typed label
 * that names a known modality ("Acupuntura") becomes the known one, so the free
 * path can never be used to declare something the product would then ignore.
 *
 * A controlled field with no form library of its own, because its callers
 * disagree about that: the preparation step and the settings card both keep
 * plain state. Keeping the option list, the labels and the rules in ONE place
 * is the point — the slugs and the label limits are validated again in SQL.
 */

type Option =
  | { kind: "known"; slug: PracticeModality }
  | { kind: "other"; label: string }
  /** The row that offers to add what she typed — never part of the value. */
  | { kind: "create"; label: string };

/** Identity of a choice. A bare string is a label typed and not yet turned into an option. */
const keyOf = (option: Option | string) =>
  typeof option === "string"
    ? `other:${option.toLowerCase()}`
    : option.kind === "known"
      ? `known:${option.slug}`
      : `other:${option.label.toLowerCase()}`;

export default function PracticeModalitiesField({
  value,
  onChange,
  other,
  onOtherChange,
  onBlur,
  disabled,
  label,
  helperText,
}: {
  value: PracticeModality[];
  onChange: (value: PracticeModality[]) => void;
  /** What she practises beyond the five, as she wrote it. */
  other: string[];
  onOtherChange: (value: string[]) => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Overrides the default label (the preparation and settings word it differently). */
  label?: string;
  helperText?: string;
}) {
  const t = useTranslations("product");
  const [input, setInput] = useState("");
  const [issue, setIssue] = useState<OtherModalityIssue | null>(null);

  const labels = useMemo(
    () =>
      Object.fromEntries(PRACTICE_MODALITIES.map((slug) => [slug, t(`practice-modality-${slug}`)])) as Record<
        PracticeModality,
        string
      >,
    [t],
  );

  const labelOf = (option: Option | string) =>
    typeof option === "string"
      ? option
      : option.kind === "known"
        ? labels[option.slug]
        : option.kind === "create"
          ? t("practice-modality-other-add", { name: option.label })
          : option.label;

  const options = useMemo<Option[]>(() => PRACTICE_MODALITIES.map((slug) => ({ kind: "known", slug })), []);
  const selected = useMemo<Option[]>(
    () => [
      ...value.map((slug): Option => ({ kind: "known", slug })),
      ...other.map((entry): Option => ({ kind: "other", label: entry })),
    ],
    [other, value],
  );

  const filter = useMemo(
    () =>
      createFilterOptions<Option>({
        stringify: (option) => (option.kind === "known" ? labels[option.slug] : option.label),
      }),
    [labels],
  );

  /**
   * Splits whatever the Autocomplete hands back into the two lists. A label
   * she just typed is checked against the rules; one that breaks them is left
   * out and the reason is said under the field.
   */
  const commit = (next: readonly (Option | string)[]) => {
    const known: PracticeModality[] = [];
    const typed: string[] = [];
    let refused: OtherModalityIssue | null = null;

    for (const entry of next) {
      if (typeof entry !== "string" && entry.kind === "known") {
        known.push(entry.slug);
        continue;
      }
      const cleaned = cleanOtherModality(typeof entry === "string" ? entry : entry.label);
      if (!cleaned) continue;
      const canonical = matchPracticeModality(cleaned, labels);
      if (canonical) {
        known.push(canonical);
        continue;
      }
      // Already stored labels were validated when they were added (and again
      // in SQL); only what is new is judged here.
      const isNew = typeof entry === "string" || entry.kind === "create";
      const problem = isNew ? otherModalityIssue(cleaned) : null;
      if (problem) {
        refused = problem;
        continue;
      }
      typed.push(cleaned);
    }

    let others = normalizeOtherModalities(typed);
    if (others.length > PRACTICE_MODALITY_OTHER_MAX) {
      others = others.slice(0, PRACTICE_MODALITY_OTHER_MAX);
      refused = "too_many";
    }

    setIssue(refused);
    onChange(PRACTICE_MODALITIES.filter((slug) => known.includes(slug)));
    onOtherChange(others);
  };

  return (
    <Autocomplete<Option, true, false, true>
      multiple
      freeSolo
      disableCloseOnSelect
      filterSelectedOptions
      handleHomeEndKeys
      disabled={disabled}
      options={options}
      value={selected}
      inputValue={input}
      getOptionLabel={labelOf}
      getOptionKey={(option) => (typeof option === "string" ? option : `${option.kind}:${keyOf(option)}`)}
      isOptionEqualToValue={(option, chosen) => keyOf(option) === keyOf(chosen)}
      filterOptions={(available, state) => {
        const filtered = filter(available, state);
        const typed = cleanOtherModality(state.inputValue);
        // Offered as a row, not only as "press Enter": on a phone the keyboard's
        // Enter is easy to miss, and a field that silently drops what she
        // typed is how a free answer never gets given.
        if (
          typed &&
          !matchPracticeModality(typed, labels) &&
          !other.some((entry) => entry.toLowerCase() === typed.toLowerCase())
        ) {
          filtered.push({ kind: "create", label: typed });
        }
        return filtered;
      }}
      onChange={(_, next) => commit(next)}
      onInputChange={(_, next, reason) => {
        // A comma or semicolon ends a label, the way it does in any list.
        if (reason === "input" && /[,;]/.test(next)) {
          const parts = next.split(/[,;]/);
          const rest = parts.pop() ?? "";
          commit([...selected, ...parts]);
          setInput(rest.trimStart());
          return;
        }
        setInput(next);
        if (reason === "input") setIssue(null);
      }}
      onBlur={() => {
        // Leaving the field with something typed keeps it: clicking the
        // step's button must not throw away the answer she was in the middle of.
        if (input.trim()) {
          commit([...selected, input]);
          setInput("");
        }
        onBlur?.();
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? t("practice-context-modalities")}
          error={Boolean(issue)}
          helperText={
            issue ? t(`practice-modality-other-issue-${issue}`) : (helperText ?? t("practice-modality-other-help"))
          }
        />
      )}
    />
  );
}
