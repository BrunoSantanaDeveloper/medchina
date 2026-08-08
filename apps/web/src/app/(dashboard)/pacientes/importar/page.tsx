"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import ImportMappingStep from "@/components/product/import-mapping-step";
import ImportReviewStep from "@/components/product/import-review-step";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiCheckFull from "@/icons/nexture/ni-check-full";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import {
  attachImportFile,
  buildHistoryPreview,
  buildImportPreview,
  buildSchedulePreview,
  type ColumnMapping,
  columnValues,
  commitImportBatch,
  createImportBatch,
  type DateColumnVerdict,
  type DateOrder,
  type ExistingAppointment,
  type ExistingPatient,
  fetchExistingPatients,
  fetchImportAllowance,
  guessColumnMapping,
  HISTORY_FIELDS,
  type ImportCounts,
  type ImportFieldKey,
  type ImportKind,
  type ParsedTable,
  parseSpreadsheet,
  PATIENT_FIELDS,
  resolveDateOrder,
  revertImportBatch,
  SCHEDULE_FIELDS,
  stageImportRows,
} from "@/lib/import";
import { ensureProTrial } from "@/lib/pro-trial";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Phase = "loading" | "wizard" | "running" | "failed" | "done";

/**
 * Importing patients from the system she is leaving (docs/IMPORT-EXPORT.md).
 *
 * Who: a professional on day one, with her practice still in another product.
 * Job: stop retyping — get her patients in without losing or corrupting any.
 * Success: she sees her own patients in /pacientes minutes after signing up,
 * and trusts what came across because she approved it line by line first.
 *
 * The shape is a wizard rather than a form because the decisions are
 * sequential and each one narrows the next (file → what the columns mean →
 * what will be written). Nothing touches the database until the last step:
 * parsing, mapping and the dry-run all happen in the browser, over the file
 * she picked.
 */
export default function ImportarPacientes() {
  const t = useTranslations("product");
  const { timezone } = useCurrentOrg();

  const [phase, setPhase] = useState<Phase>("loading");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingPatient[]>([]);
  const [appointments, setAppointments] = useState<ExistingAppointment[]>([]);
  const [maxRows, setMaxRows] = useState<number | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<ImportKind>("patients");
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [sourceSystem, setSourceSystem] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [surnameColumn, setSurnameColumn] = useState<number | undefined>(undefined);
  const [dateVerdict, setDateVerdict] = useState<DateColumnVerdict | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder | undefined>(undefined);

  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [trialStarted, setTrialStarted] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState(false);
  const [undoState, setUndoState] = useState<"idle" | "running" | "done">("idle");
  const [undoBlockers, setUndoBlockers] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) {
        setError(t("not-configured"));
        setPhase("wizard");
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: membership } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("user_id", user?.id ?? "")
        .limit(1)
        .maybeSingle();

      if (!membership) {
        setError(t("no-workspace"));
        setPhase("wizard");
        return;
      }

      setOrgId(membership.org_id as string);
      const [allowance, patients] = await Promise.all([
        fetchImportAllowance(supabase, membership.org_id as string),
        fetchExistingPatients(supabase, membership.org_id as string),
      ]);
      if (allowance.ok) {
        setMaxRows(allowance.data.maxRows);
        if (!allowance.data.allowed) setBlockedReason(allowance.data.reason);
      }
      if (patients.ok) setExisting(patients.data);

      // The calendar as it stands, so the agenda preview can refuse a slot
      // that is already taken instead of letting the writer discover it.
      const { data: booked } = await supabase
        .from("consultations")
        .select("scheduled_for, duration_minutes")
        .eq("org_id", membership.org_id as string)
        .in("status", ["scheduled", "in_progress"])
        .not("scheduled_for", "is", null)
        .gte("scheduled_for", new Date().toISOString());
      setAppointments(
        (booked ?? []).map((row) => ({
          scheduledFor: row.scheduled_for as string,
          durationMinutes: (row.duration_minutes as number | null) ?? null,
        })),
      );

      setPhase("wizard");
    };
    load();
  }, [t]);

  // The date column means something different per kind — a birth date on a
  // patients sheet, the day the consultation happened on a history sheet — but
  // the ambiguity question it raises is the same.
  const dateField: ImportFieldKey = kind === "patients" ? "birth_date" : "date";

  const applyGuess = useCallback((parsed: ParsedTable, forKind: ImportKind) => {
    const guess = guessColumnMapping(parsed.headers, forKind);
    const dateColumn = forKind === "patients" ? guess.mapping.birth_date : guess.mapping.date;
    const verdict = dateColumn === undefined ? null : resolveDateOrder(columnValues(parsed, dateColumn));

    setMapping(guess.mapping);
    setSurnameColumn(guess.surnameColumn);
    setDateVerdict(verdict);
    setDateOrder(verdict?.order ?? undefined);
  }, []);

  const handleFile = async (picked: File | null) => {
    setError(null);
    setFile(picked);
    setTable(null);
    if (!picked) return;

    try {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      const parsed = parseSpreadsheet(bytes);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError(t("import-file-empty"));
        return;
      }
      setTable(parsed);
      applyGuess(parsed, kind);
    } catch {
      setError(t("import-file-read-error"));
    }
  };

  // Switching what she is importing re-reads the same headers with the other
  // vocabulary: "Data" is a birth date on one sheet and a visit date on the
  // other, and keeping the old mapping would silently carry that mistake.
  const changeKind = (next: ImportKind) => {
    setKind(next);
    setError(null);
    if (table) applyGuess(table, next);
    else {
      setMapping({});
      setSurnameColumn(undefined);
      setDateVerdict(null);
      setDateOrder(undefined);
    }
  };

  const changeMapping = (field: ImportFieldKey, index: number | null) => {
    setMapping((current) => {
      const next = { ...current };
      if (index === null) delete next[field];
      else next[field] = index;
      return next;
    });
    if (field === dateField && table) {
      const verdict = index === null ? null : resolveDateOrder(columnValues(table, index));
      setDateVerdict(verdict);
      setDateOrder(verdict?.order ?? undefined);
    }
  };

  const preview = useMemo(() => {
    if (!table) return null;
    if (kind === "history") return buildHistoryPreview({ table, mapping, dateOrder, existing });
    if (kind === "schedule") {
      return buildSchedulePreview({ table, mapping, dateOrder, existing, appointments, timeZone: timezone });
    }
    return buildImportPreview({ table, mapping, surnameColumn, dateOrder, existing });
  }, [kind, table, mapping, surnameColumn, dateOrder, existing, appointments, timezone]);

  const dateSample = useMemo(() => {
    const column = mapping[dateField];
    if (!table || column === undefined) return "";
    return columnValues(table, column)[0] ?? "";
  }, [table, mapping, dateField]);

  const downloadIssues = useCallback(() => {
    if (!preview || !table) return;
    const rows = preview.rows.filter(
      (row) => row.action === "error" || row.action === "skip" || row.warnings.length > 0,
    );
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = [t("import-csv-line"), t("import-csv-reason"), ...table.headers];
    const body = rows.map((row) => [
      String(row.rowNumber),
      [...(row.errorCode ? [row.errorCode] : []), ...row.warnings.map((warning) => warning.code)]
        .map((code) => t(`import-issue-${code}`))
        .join(" | "),
      ...table.headers.map((columnHeader) => row.raw[columnHeader] ?? ""),
    ]);
    // A BOM and semicolons, because this file is meant to be reopened in the
    // same Excel that produced the original.
    const csv = ["﻿" + [header, ...body].map((line) => line.map(escape).join(";")).join("\r\n")];
    const url = URL.createObjectURL(new Blob(csv, { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "linhas-com-problema.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [preview, table, t]);

  const runImport = async () => {
    if (!orgId || !preview) return;
    setPhase("running");
    setError(null);
    const supabase = createClient();

    // A retry reuses the batch it already created: a second one would leave an
    // orphan behind and stage the same rows twice under a different id.
    let currentBatch = batchId;
    if (!currentBatch) {
      const created = await createImportBatch(supabase, {
        orgId,
        kind,
        sourceSystem,
        fileName: file?.name,
      });
      if (!created.ok) {
        setError(t("import-error"));
        setPhase("failed");
        return;
      }
      currentBatch = created.data;
      setBatchId(currentBatch);
    }

    // The original file is evidence, not a dependency: if storage refuses it
    // the import still happens and she is told the copy was not kept.
    if (file) {
      // "Pacientes (1).csv" is a normal name for an export and a bad storage
      // key, so the object gets a safe one; the original stays on the batch.
      const safeName =
        file.name
          .normalize("NFKD")
          .replace(/[^a-zA-Z0-9._-]+/g, "-")
          .slice(-80) || "planilha.csv";
      const path = `${orgId}/${currentBatch}/${safeName}`;
      const upload = await supabase.storage.from("imports").upload(path, file, { upsert: true });
      if (upload.error) setUploadWarning(true);
      else await attachImportFile(supabase, { batchId: currentBatch, filePath: path });
    }

    const staged = await stageImportRows(supabase, {
      batchId: currentBatch,
      orgId,
      rows: preview.rows,
      mapping: { ...mapping, surname: surnameColumn ?? null, dateOrder: dateOrder ?? null },
    });
    if (!staged.ok) {
      setError(t("import-error"));
      setPhase("failed");
      return;
    }

    const committed = await commitImportBatch(supabase, { batchId: currentBatch, orgId });
    if (!committed.ok) {
      setError(t(`import-error-${committed.code ?? "generic"}`));
      setPhase("failed");
      return;
    }

    setCounts(committed.data);
    setPhase("done");
    // Bringing her charts in is real use of the product, and it used to leave
    // the Pro trial unreachable (migration 0084). Fired after the commit so a
    // billing call can never put an import at risk.
    void ensureProTrial(orgId, "import").then(({ started }) => setTrialStarted(started));
  };

  const undoImport = async () => {
    if (!orgId || !batchId) return;
    setUndoState("running");
    setUndoBlockers(null);
    const supabase = createClient();
    const result = await revertImportBatch(supabase, { batchId, orgId });
    if (result.ok) {
      setUndoState("done");
      return;
    }
    setUndoState("idle");
    setUndoBlockers((result.details as Record<string, number> | undefined) ?? {});
  };

  // History needs to know WHO and WHEN before it can write anything; a patients
  // sheet only needs the name. Both block the step rather than importing rows
  // the writer would refuse one by one.
  const fields = kind === "history" ? HISTORY_FIELDS : kind === "schedule" ? SCHEDULE_FIELDS : PATIENT_FIELDS;
  const requiredField: ImportFieldKey = kind === "history" ? "body" : kind === "schedule" ? "date" : "full_name";
  const identifiesPatient = mapping.patient_ref !== undefined || mapping.patient_name !== undefined;
  const mappingReady =
    kind === "history"
      ? mapping.body !== undefined && mapping.date !== undefined && identifiesPatient
      : kind === "schedule"
        ? mapping.date !== undefined && identifiesPatient
        : mapping.full_name !== undefined;
  const dateReady = mapping[dateField] === undefined || dateVerdict?.ambiguous !== true || Boolean(dateOrder);
  const willWrite = preview ? preview.summary.create + preview.summary.update : 0;
  const withinLimit = maxRows === null || willWrite <= maxRows;

  const steps: WizardStep[] = [
    {
      title: t("import-step-file"),
      hint: t("import-step-file-hint"),
      canAdvance: Boolean(table) && !blockedReason,
      content: (
        <Box className="flex flex-col gap-5">
          <Box className="flex flex-col gap-2">
            <Typography variant="body2" className="text-text-secondary">
              {t("import-kind-label")}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={kind}
              aria-label={t("import-kind-label")}
              onChange={(_, value) => value && changeKind(value as ImportKind)}
              className="self-start"
            >
              <ToggleButton value="patients">{t("import-kind-patients")}</ToggleButton>
              <ToggleButton value="history">{t("import-kind-history")}</ToggleButton>
              <ToggleButton value="schedule">{t("import-kind-schedule")}</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="body2" className="text-text-secondary">
              {t(`import-kind-${kind}-hint`)}
            </Typography>
          </Box>

          <Box className="flex flex-col items-start gap-2">
            <Button variant="contained" color="primary" component="label" startIcon={<NiUploadCloud size="medium" />}>
              {file ? t("import-file-change") : t("import-file-pick")}
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
              />
            </Button>
            {table && (
              <Typography variant="body2" className="text-text-secondary">
                {t("import-file-detected", {
                  rows: table.rows.length,
                  delimiter: table.delimiter === "\t" ? "tab" : table.delimiter,
                  encoding: table.encoding,
                })}
              </Typography>
            )}
          </Box>

          <FormControl className="outlined" variant="standard" size="small" fullWidth>
            <FormLabel component="label" htmlFor="import-source-system">
              {t("import-source-label")}
            </FormLabel>
            <Input
              id="import-source-system"
              name="sourceSystem"
              value={sourceSystem}
              placeholder={t("import-source-placeholder")}
              onChange={(event) => setSourceSystem(event.target.value)}
            />
          </FormControl>
          <Typography variant="body2" className="text-text-secondary">
            {t("import-source-hint")}
          </Typography>

          <Alert severity="info">{t("import-scope-note")}</Alert>
        </Box>
      ),
    },
    {
      title: t("import-step-map"),
      hint: t("import-step-map-hint"),
      canAdvance: mappingReady && dateReady,
      content:
        table && preview ? (
          <ImportMappingStep
            table={table}
            fields={fields}
            dateField={dateField}
            requiredField={requiredField}
            mapping={mapping}
            surnameColumn={surnameColumn}
            dateVerdict={dateVerdict}
            dateOrder={dateOrder}
            dateSample={dateSample}
            onMappingChange={changeMapping}
            onSurnameChange={kind === "patients" ? (index) => setSurnameColumn(index ?? undefined) : undefined}
            onDateOrderChange={setDateOrder}
          />
        ) : (
          <Skeleton variant="rounded" height={220} className="rounded-3xl" />
        ),
    },
    {
      title: t("import-step-review"),
      hint: t("import-step-review-hint"),
      canAdvance: willWrite > 0 && withinLimit,
      content: preview ? (
        <ImportReviewStep preview={preview} maxRows={maxRows} onDownloadIssues={downloadIssues} />
      ) : (
        <Skeleton variant="rounded" height={220} className="rounded-3xl" />
      ),
    },
  ];

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box>
          <Typography variant="h1" component="h1" className="mb-0">
            {t("import-title")}
          </Typography>
          <Breadcrumbs>
            <Link color="inherit" href="/inicio">
              {t("home-breadcrumb")}
            </Link>
            <Link color="inherit" href="/pacientes">
              {t("patients-title")}
            </Link>
            <Typography variant="body2">{t("import-title")}</Typography>
          </Breadcrumbs>
        </Box>
      </Grid>

      {error && phase !== "failed" && (
        <Grid size={12}>
          <Alert severity="error">{error}</Alert>
        </Grid>
      )}

      {blockedReason && (
        <Grid size={12}>
          <Alert severity="warning">{t(`import-error-${blockedReason}`)}</Alert>
        </Grid>
      )}

      <Grid size={12}>
        {phase === "loading" ? (
          <Skeleton variant="rounded" height={320} className="mx-auto max-w-4xl rounded-3xl" />
        ) : phase === "running" ? (
          <Card className="mx-auto w-full max-w-4xl">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <CircularProgress />
              <Typography variant="h4" component="p" className="text-text-primary mb-0">
                {t("import-running")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("import-running-hint")}
              </Typography>
            </CardContent>
          </Card>
        ) : phase === "failed" ? (
          /* A failure is not a dead end: the mapping she confirmed is still in
             memory and the batch already exists, so retrying costs one click
             instead of walking the wizard again. */
          <Card className="mx-auto w-full max-w-4xl">
            <CardContent className="flex flex-col gap-4">
              <Typography variant="h4" component="h2" className="text-text-primary mb-0">
                {t("import-failed-title")}
              </Typography>
              <Typography variant="body1" className="text-text-secondary leading-6">
                {error ?? t("import-error")}
              </Typography>
              <Box className="flex flex-row flex-wrap items-center gap-3">
                <Button variant="contained" color="primary" onClick={runImport}>
                  {t("import-retry")}
                </Button>
                <Button variant="text" color="grey" onClick={() => setPhase("wizard")}>
                  {t("import-back-to-review")}
                </Button>
              </Box>
            </CardContent>
          </Card>
        ) : phase === "done" && counts ? (
          <Card className="mx-auto w-full max-w-4xl">
            <CardContent className="flex flex-col gap-4">
              <Box className="flex flex-row items-start gap-3">
                <NiCheckFull size="large" className="text-primary flex-none" />
                <Box className="flex flex-col gap-1">
                  <Typography variant="h4" component="h2" className="text-text-primary mb-0">
                    {t("import-done")}
                  </Typography>
                  <Typography variant="body1" className="text-text-secondary leading-6">
                    {t("import-done-body", counts)}
                  </Typography>
                </Box>
              </Box>

              {/* What did NOT come across, stated where she is counting what
                  did — silence here becomes a support ticket later. */}
              <Alert severity="info">{t("import-scope-note")}</Alert>
              {/* The import may have started the Pro trial (migration 0084) —
                  said here, because a 14-day clock she never saw start is a
                  trial that expires "without being used". */}
              {trialStarted && <Alert severity="info">{t("trial-auto-started")}</Alert>}
              {uploadWarning && <Alert severity="info">{t("import-upload-warning")}</Alert>}
              {undoState === "done" && <Alert severity="success">{t("import-undo-done")}</Alert>}
              {undoBlockers && (
                <Alert severity="warning">
                  {t("import-undo-blocked")}{" "}
                  {Object.entries(undoBlockers)
                    .map(([key, value]) => t(`import-blocked-${key}`, { count: value }))
                    .join(" · ")}
                </Alert>
              )}

              <Box className="flex flex-row flex-wrap items-center gap-3">
                <Button variant="contained" color="primary" href="/pacientes" LinkComponent={Link}>
                  {t("import-done-cta")}
                </Button>
                {undoState !== "done" && (
                  <Button variant="text" color="grey" disabled={undoState === "running"} onClick={undoImport}>
                    {t("import-undo")}
                  </Button>
                )}
              </Box>
              {undoState !== "done" && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-undo-hint")}
                </Typography>
              )}
            </CardContent>
          </Card>
        ) : (
          <SetupWizard
            steps={steps}
            onComplete={runImport}
            completeLabel={t("import-submit", { count: willWrite })}
            className="max-w-4xl"
          />
        )}
      </Grid>
    </Grid>
  );
}
