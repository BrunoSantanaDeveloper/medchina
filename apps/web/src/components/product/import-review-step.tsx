"use client";

import { useTranslations } from "next-intl";

import { Alert, Box, Button, Typography } from "@mui/material";

import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import type { ImportPreview, StagedRow } from "@/lib/import";

const ISSUE_LIMIT = 8;

/**
 * Step 3 of the import: the dry-run, before anything is written.
 *
 * It answers one question — "what will this do to my records?" — with four
 * numbers and then, deliberately, only the lines that need her: a list of
 * every good row would bury the four that do not import. The rest leave in a
 * CSV she can fix and re-send.
 */
export default function ImportReviewStep({
  preview,
  maxRows,
  onDownloadIssues,
}: {
  preview: ImportPreview;
  maxRows: number | null;
  onDownloadIssues: () => void;
}) {
  const t = useTranslations("product");
  const { summary } = preview;

  const attention = preview.rows.filter(
    (row) => row.action === "error" || row.action === "skip" || row.warnings.length > 0,
  );
  const willWrite = summary.create + summary.update;
  const overLimit = maxRows !== null && willWrite > maxRows;

  const reasonFor = (row: StagedRow): string[] => {
    const codes = [...(row.errorCode ? [row.errorCode] : []), ...row.warnings.map((warning) => warning.code)];
    return codes.map((code) => t(`import-issue-${code}`));
  };

  const tiles: { key: string; value: number; tone: string }[] = [
    { key: "create", value: summary.create, tone: "text-primary" },
    { key: "update", value: summary.update, tone: "text-accent-2-dark dark:text-accent-2-light" },
    { key: "skip", value: summary.skip, tone: "text-text-secondary" },
    { key: "error", value: summary.error, tone: "text-text-secondary" },
  ];

  return (
    <Box className="flex flex-col gap-5">
      <Box className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Box key={tile.key} className="border-grey-100 flex flex-col gap-1 rounded-2xl border p-4">
            <Typography variant="h3" component="p" className={`mb-0 ${tile.tone}`}>
              {tile.value}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t(`import-count-${tile.key}`)}
            </Typography>
          </Box>
        ))}
      </Box>

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
