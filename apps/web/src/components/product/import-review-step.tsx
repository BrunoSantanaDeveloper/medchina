"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertTitle, Box, Button, Checkbox, FormControlLabel, Typography } from "@mui/material";

import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import type { ImportKind, ImportPreview, StagedRow } from "@/lib/import";

const ISSUE_LIMIT = 8;

/**
 * Step 3 of the import: the dry-run, before anything is written.
 *
 * It answers one question — "what will this do to my records?" — and it has to
 * answer it in WORDS, not only in numbers. It used to show four counts whose
 * labels ("Novos cadastros") were identical for all three kinds of import,
 * which is how a practice imported a sheet of attendances as patients and read
 * a screen that described the outcome correctly: three people became eight
 * charts, and nothing on this page could have contradicted the choice made two
 * steps earlier.
 *
 * So this step now states the object it is about to create, says how many
 * charts the workspace holds today, names the columns being thrown away, and —
 * when the file repeats the same person line after line — STOPS, because a
 * warning that can be clicked past is not a safeguard.
 */
export default function ImportReviewStep({
  preview,
  kind,
  existingCount,
  discardedColumns,
  maxRows,
  acknowledged,
  onAcknowledgedChange,
  onDownloadIssues,
}: {
  preview: ImportPreview;
  kind: ImportKind;
  /** Charts in the workspace today, or null when we cannot count them exactly. */
  existingCount: number | null;
  /** Headers she chose not to import — silence here reads as "we took it all". */
  discardedColumns: string[];
  maxRows: number | null;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  onDownloadIssues: () => void;
}) {
  const t = useTranslations("product");
  const { summary, repeatedNames } = preview;

  const attention = preview.rows.filter(
    (row) => row.action === "error" || row.action === "skip" || row.warnings.length > 0,
  );
  const willWrite = summary.create + summary.update;
  const overLimit = maxRows !== null && willWrite > maxRows;
  const shapeSuspicious = kind === "patients" && Boolean(repeatedNames?.suspicious);

  const reasonFor = (row: StagedRow): string[] => {
    const codes = [...(row.errorCode ? [row.errorCode] : []), ...row.warnings.map((warning) => warning.code)];
    return codes.map((code) => t(`import-issue-${code}`));
  };

  const tiles: { key: string; label: string; value: number; tone: string }[] = [
    { key: "create", label: t(`import-count-create-${kind}`), value: summary.create, tone: "text-primary" },
    {
      key: "update",
      label: t(`import-count-update-${kind}`),
      value: summary.update,
      tone: "text-accent-2-dark dark:text-accent-2-light",
    },
    { key: "skip", label: t("import-count-skip"), value: summary.skip, tone: "text-text-secondary" },
    { key: "error", label: t("import-count-error"), value: summary.error, tone: "text-text-secondary" },
  ];

  return (
    <Box className="flex flex-col gap-5">
      {/* The assertion the four numbers alone never made: WHAT is being created. */}
      <Box className="flex flex-col gap-1">
        <Typography variant="h5" component="p" className="text-text-primary mb-0">
          {t(`import-review-lead-${kind}`, { count: summary.create })}
        </Typography>
        {existingCount !== null && (
          <Typography variant="body2" className="text-text-secondary">
            {t(`import-review-base-${kind}`, { count: existingCount })}
          </Typography>
        )}
      </Box>

      <Box className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Box key={tile.key} className="border-grey-100 flex flex-col gap-1 rounded-2xl border p-4">
            <Typography variant="h3" component="p" className={`mb-0 ${tile.tone}`}>
              {tile.value}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {tile.label}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* The gate. Not an alert she can scroll past: the wizard will not advance
          until she either says this really is a patient registry, or goes back
          and imports it as what it is. */}
      {/* The checkbox sits OUTSIDE the alert: role="alert" is an assertive live
          region, so a control inside it made a screen reader re-announce the
          whole warning every time she toggled it. */}
      {shapeSuspicious && repeatedNames && (
        <Box className="flex flex-col gap-2">
          <Alert severity="warning">
            <AlertTitle>{t("import-shape-title")}</AlertTitle>
            <Typography variant="body2" className="leading-6">
              {t("import-shape-body", {
                repeated: repeatedNames.repeated,
                considered: repeatedNames.considered,
                examples: repeatedNames.examples.join(", "),
                most: repeatedNames.maxPerName,
              })}
            </Typography>
            <Typography variant="body2" className="mt-2 leading-6">
              {t("import-shape-fix")}
            </Typography>
          </Alert>
          <FormControlLabel
            control={
              <Checkbox checked={acknowledged} onChange={(event) => onAcknowledgedChange(event.target.checked)} />
            }
            label={t("import-shape-confirm", { count: summary.create })}
          />
        </Box>
      )}

      {preview.columnWarnings.length > 0 && (
        <Box className="flex flex-col gap-1">
          {preview.columnWarnings.map((warning) => (
            <Typography key={`${warning.code}-${warning.header ?? ""}`} variant="body2" className="text-text-secondary">
              <span className="text-text-primary font-medium">{warning.header ?? ""}</span>
              {warning.header ? " — " : ""}
              {t(`import-issue-${warning.code}`)}
            </Typography>
          ))}
        </Box>
      )}

      {discardedColumns.length > 0 && (
        <Typography variant="body2" className="text-text-secondary">
          {t("import-discarded-columns", {
            count: discardedColumns.length,
            columns: discardedColumns.join(", "),
          })}
        </Typography>
      )}

      {summary.update > 0 && <Alert severity="info">{t("import-update-note")}</Alert>}

      {overLimit && <Alert severity="warning">{t("import-limit", { max: maxRows ?? 0, rows: willWrite })}</Alert>}

      {willWrite === 0 && <Alert severity="warning">{t("import-nothing")}</Alert>}

      {attention.length > 0 && (
        <Box className="flex flex-col gap-2">
          <Box className="flex flex-row flex-wrap items-center justify-between gap-2">
            <Typography variant="body2" className="text-text-secondary">
              {t("import-issues")}
            </Typography>
            <Button
              variant="text"
              color="grey"
              size="small"
              startIcon={<NiDownloadCloud size="small" />}
              onClick={onDownloadIssues}
            >
              {t("import-issues-download")}
            </Button>
          </Box>

          <Box className="border-grey-100 divide-grey-100 flex flex-col divide-y rounded-2xl border">
            {attention.slice(0, ISSUE_LIMIT).map((row) => (
              <Box key={row.rowNumber} className="flex flex-col gap-0.5 px-4 py-3">
                <Typography variant="body2" className="text-text-primary font-medium">
                  {t("import-issue-line", { line: row.rowNumber })}
                  {row.normalized.full_name ? ` — ${row.normalized.full_name}` : ""}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {reasonFor(row).join(" · ")}
                </Typography>
              </Box>
            ))}
          </Box>

          {attention.length > ISSUE_LIMIT && (
            <Typography variant="body2" className="text-text-secondary">
              {t("import-issues-more", { count: attention.length - ISSUE_LIMIT })}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
