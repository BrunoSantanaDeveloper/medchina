"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Grid, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import IllustrationStorage from "@/icons/illustrations/illustration-storage";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiUser from "@/icons/nexture/ni-user";
import { getProductAction } from "@/lib/product-actions";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type PatientRow = {
  id: string;
  fullName: string;
  alerts: { label: string }[];
  lastConsultation: string | null;
  archivedAt: string | null;
};

const NEW_PATIENT_HREF = getProductAction("new-patient").href;
const IMPORT_PATIENTS_HREF = getProductAction("import-patients").href;

/**
 * Patients (PRD §9.4) on the app's standard table model: the job here really
 * is scan/search/manage many rows — find the person, check her alerts and last
 * visit at a glance, open the record in one click. Clinical alerts stay
 * visible on the row BEFORE the consultation (PRD §8.1).
 *
 * The three zero-row answers stay distinct: no patients at all (path to the
 * first activation step), an empty archive (way back to the active list), and
 * a search that matched nothing (named after the query). An error is an error
 * — the table is not rendered at all, never an empty-looking grid.
 */
export default function Pacientes() {
  const t = useTranslations("product");
  const locale = useLocale();
  const router = useRouter();
  const [patientsState, setPatientsState] = useState<RemoteState<PatientRow[], string>>(() => remoteLoading());
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setPatientsState(remoteLoading());
    if (!isSupabaseConfigured) {
      setPatientsState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("patients")
      .select("id, full_name, alerts, archived_at, consultations(started_at, status)")
      .order("full_name");

    if (loadError) {
      setPatientsState(remoteError(t("patients-load-error")));
      return;
    }

    const patients = (data ?? []).map((row) => {
      const visits = (row.consultations as unknown as { started_at: string; status: string }[] | null) ?? [];
      const last =
        visits
          .filter((visit) => !["scheduled", "cancelled"].includes(visit.status))
          .map((visit) => visit.started_at)
          .sort((a, b) => b.localeCompare(a))[0] ?? null;
      return {
        id: row.id as string,
        fullName: row.full_name as string,
        alerts: (row.alerts as { label: string }[] | null) ?? [],
        lastConsultation: last,
        archivedAt: row.archived_at as string | null,
      };
    });
    setPatientsState(patients.length === 0 ? remoteEmpty() : remoteSuccess(patients));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const patients = useMemo(() => {
    if (patientsState.status === "success") return patientsState.data;
    if ("previous" in patientsState) return patientsState.previous ?? [];
    return [];
  }, [patientsState]);

  // The active/archived split is a TAB, not a search: the grid receives only
  // the chosen slice, and the quick filter searches within it.
  const rows = useMemo(
    () => patients.filter((patient) => Boolean(patient.archivedAt) === showArchived),
    [patients, showArchived],
  );
  const activeCount = patients.length - patients.filter((patient) => patient.archivedAt).length;
  const archivedCount = patients.length - activeCount;

  const openRecord = useCallback((id: string) => router.push(`/pacientes/${id}`), [router]);

  const columns = useMemo<GridColDef<PatientRow>[]>(
    () => [
      {
        field: "fullName",
        headerName: t("patients-col-name"),
        flex: 2,
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<PatientRow, string>) => (
          <Box className="flex h-full items-center gap-3">
            <span className="bg-primary/10 text-primary flex h-9 w-9 flex-none items-center justify-center rounded-full font-semibold">
              {(params.value ?? "?").charAt(0).toUpperCase()}
            </span>
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "lastConsultation",
        headerName: t("patients-col-last-visit"),
        flex: 1,
        minWidth: 150,
        // The app's locale, not the browser's: a pt-BR chart was showing 3/13/2019.
        valueFormatter: (value: string | null) =>
          value ? new Intl.DateTimeFormat(locale).format(new Date(value)) : t("patients-no-visit"),
      },
      {
        field: "alerts",
        headerName: t("patients-col-alerts"),
        flex: 1.5,
        minWidth: 160,
        sortable: false,
        // Joined labels as the value, so the quick filter also finds patients
        // by alert text (e.g. "gestante").
        valueGetter: (_, row) => row.alerts.map((alert) => alert.label).join(", "),
        renderCell: (params: GridRenderCellParams<PatientRow>) => (
          // Clinical alerts must be visible BEFORE the consultation (PRD §8.1).
          <Box className="flex h-full flex-wrap items-center gap-1">
            {params.row.alerts.slice(0, 2).map((alert) => (
              <span
                key={alert.label}
                className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
              >
                {alert.label}
              </span>
            ))}
            {params.row.alerts.length > 2 && (
              <span className="bg-grey-100 text-text-secondary flex-none rounded-full px-2 py-1 text-xs font-semibold">
                +{params.row.alerts.length - 2}
              </span>
            )}
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => [
          <GridActionsCellItem
            key="open"
            icon={<NiUser size="medium" />}
            label={t("patients-open-record")}
            onClick={() => openRecord(String(params.id))}
            showInMenu
          />,
          <GridActionsCellItem
            key="schedule"
            icon={<NiCalendar size="medium" />}
            label={t("agenda-schedule")}
            onClick={() => router.push(`/agenda?new=1&patientId=${params.id}`)}
            showInMenu
          />,
        ],
      },
    ],
    [locale, openRecord, router, t],
  );

  const header = (
    <Box>
      <Typography variant="h1" component="h1" className="mb-0">
        {t("patients-title")}
      </Typography>
      <Breadcrumbs>
        <Link color="inherit" href="/inicio">
          {t("home-breadcrumb")}
        </Link>
        <Typography variant="body2">{t("patients-title")}</Typography>
      </Breadcrumbs>
    </Box>
  );

  // An error is an error: the table never renders looking like an empty list.
  if (patientsState.status === "error") {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>{header}</Grid>
        <Grid size={12}>
          <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
            {patientsState.error}
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const loading = patientsState.status === "idle" || patientsState.status === "loading";

  const noRowsOverlay = !showArchived ? (
    // Active tab with zero rows: either a brand-new workspace or everyone was
    // archived — both lead to the first-patient action (activation step 2).
    // The grid frames the list already, so the drawing goes unframed.
    <EmptyState
      illustration={<IllustrationAccounts />}
      title={t("patients-empty-title")}
      description={t("patients-empty-body")}
      action={{ label: t("patients-empty-cta"), href: NEW_PATIENT_HREF }}
      secondaryAction={{ label: t("patients-import-cta"), href: IMPORT_PATIENTS_HREF }}
      framed={false}
    />
  ) : (
    <EmptyState
      illustration={<IllustrationStorage />}
      title={t("patients-archived-empty-title")}
      description={t("patients-archived-empty-body")}
      action={{ label: t("patients-show-active"), onClick: () => setShowArchived(false) }}
      framed={false}
    />
  );

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <DataTable<PatientRow>
          rows={rows}
          columns={columns}
          loading={loading}
          header={header}
          actions={
            <>
              {/* Migrating stays secondary: the primary job here is still to
                  open a chart, and only a newcomer imports — once. */}
              <Button variant="text" color="grey" href={IMPORT_PATIENTS_HREF} LinkComponent={Link}>
                {t("patients-import-cta")}
              </Button>
              <Button variant="contained" color="primary" href={NEW_PATIENT_HREF} LinkComponent={Link}>
                {t("patients-new")}
              </Button>
            </>
          }
          filters={
            <ToggleButtonGroup
              exclusive
              size="small"
              value={showArchived ? "archived" : "active"}
              onChange={(_, value) => value && setShowArchived(value === "archived")}
              aria-label={t("patients-filter-label")}
            >
              <ToggleButton value="active">{t("patients-active", { count: activeCount })}</ToggleButton>
              <ToggleButton value="archived">{t("patients-archived", { count: archivedCount })}</ToggleButton>
            </ToggleButtonGroup>
          }
          labels={{
            search: t("patients-search"),
            columns: t("table-columns"),
            filters: t("table-filters"),
            export: t("table-export"),
            print: t("table-print"),
            exportCsv: t("table-export-csv"),
          }}
          noRowsOverlay={noRowsOverlay}
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary text-center">
              {t("patients-search-empty", { query })}
            </Typography>
          }
          onRowClick={(row) => openRecord(row.id)}
          onQuickFilterChange={setQuery}
          pageSize={20}
          pageSizeOptions={[10, 20, 50]}
        />
      </Grid>
    </Grid>
  );
}
