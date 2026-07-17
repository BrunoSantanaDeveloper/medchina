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
  Grid,
  Input,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiArchive from "@/icons/nexture/ni-archive";
import NiSearch from "@/icons/nexture/ni-search";
import NiUsers from "@/icons/nexture/ni-users";
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

/**
 * Patients (PRD §9.4). The job is "find the person I'm about to see and open
 * her record" — so this is a searchable list of PEOPLE with their clinical
 * alerts and last visit, not a data grid of columns. Zero data leads straight
 * to the first-patient action (the first activation step).
 */
export default function Pacientes() {
  const t = useTranslations("product");
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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return patients.filter(
      (patient) => Boolean(patient.archivedAt) === showArchived && (!q || patient.fullName.toLowerCase().includes(q)),
    );
  }, [patients, query, showArchived]);

  const activeCount = patients.filter((patient) => !patient.archivedAt).length;
  const archivedCount = patients.filter((patient) => patient.archivedAt).length;

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
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
          {patientsState.status === "success" && (
            <Button variant="contained" color="primary" href={NEW_PATIENT_HREF} LinkComponent={Link}>
              {t("patients-new")}
            </Button>
          )}
        </Box>
      </Grid>

      <Grid size={12}>
        <Card component="section">
          <CardContent className="flex flex-col gap-4">
            {patientsState.status === "error" ? (
              <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
                {patientsState.error}
              </Alert>
            ) : patientsState.status === "idle" || patientsState.status === "loading" ? (
              <Skeleton variant="rounded" height={220} className="rounded-3xl" />
            ) : patientsState.status === "empty" ? (
              <EmptyState
                icon={<NiUsers />}
                title={t("patients-empty-title")}
                description={t("patients-empty-body")}
                action={{ label: t("patients-empty-cta"), href: NEW_PATIENT_HREF }}
              />
            ) : (
              <>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={showArchived ? "archived" : "active"}
                  onChange={(_, value) => value && setShowArchived(value === "archived")}
                  aria-label={t("patients-filter-label")}
                  className="self-start"
                >
                  <ToggleButton value="active">{t("patients-active", { count: activeCount })}</ToggleButton>
                  <ToggleButton value="archived">{t("patients-archived", { count: archivedCount })}</ToggleButton>
                </ToggleButtonGroup>

                <Box className="border-grey-100 flex flex-row items-center gap-2 rounded-2xl border px-3 py-1.5">
                  <NiSearch size="small" className="text-text-secondary flex-none" />
                  <Input
                    disableUnderline
                    fullWidth
                    placeholder={t("patients-search")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </Box>

                {filtered.length === 0 && !showArchived && !query && activeCount === 0 ? (
                  <EmptyState
                    icon={<NiUsers />}
                    title={t("patients-empty-title")}
                    description={t("patients-empty-body")}
                    action={{ label: t("patients-empty-cta"), href: NEW_PATIENT_HREF }}
                    className="border-none py-8"
                  />
                ) : filtered.length === 0 && showArchived && !query ? (
                  <EmptyState
                    icon={<NiArchive />}
                    title={t("patients-archived-empty-title")}
                    description={t("patients-archived-empty-body")}
                    action={{ label: t("patients-show-active"), onClick: () => setShowArchived(false) }}
                    className="border-none py-8"
                  />
                ) : filtered.length === 0 ? (
                  <Typography variant="body2" className="text-text-secondary py-8 text-center">
                    {t("patients-search-empty", { query })}
                  </Typography>
                ) : (
                  <Box className="flex flex-col gap-1">
                    {filtered.map((patient) => (
                      <Link
                        key={patient.id}
                        href={`/pacientes/${patient.id}`}
                        className="hover:bg-grey-25 flex flex-row items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
                      >
                        <span className="bg-primary/10 text-primary flex h-10 w-10 flex-none items-center justify-center rounded-full font-semibold">
                          {patient.fullName.charAt(0).toUpperCase()}
                        </span>
                        <Box className="min-w-0 flex-1">
                          <Typography variant="body1" className="text-text-primary truncate font-medium">
                            {patient.fullName}
                          </Typography>
                          <Typography variant="body2" className="text-text-secondary">
                            {patient.lastConsultation
                              ? t("patients-last-visit", {
                                  date: new Date(patient.lastConsultation).toLocaleDateString(),
                                })
                              : t("patients-no-visit")}
                          </Typography>
                        </Box>
                        {/* Clinical alerts must be visible BEFORE the consultation (PRD §8.1). */}
                        {patient.alerts.slice(0, 2).map((alert) => (
                          <span
                            key={alert.label}
                            className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light hidden flex-none rounded-full px-2.5 py-1 text-xs font-semibold sm:inline"
                          >
                            {alert.label}
                          </span>
                        ))}
                      </Link>
                    ))}
                  </Box>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
