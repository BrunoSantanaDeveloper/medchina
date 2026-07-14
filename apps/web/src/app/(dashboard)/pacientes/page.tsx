"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Box, Breadcrumbs, Button, Card, CardContent, Grid, Input, Skeleton, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiSearch from "@/icons/nexture/ni-search";
import NiUsers from "@/icons/nexture/ni-users";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type PatientRow = {
  id: string;
  fullName: string;
  alerts: { label: string }[];
  lastConsultation: string | null;
};

/**
 * Patients (PRD §9.4). The job is "find the person I'm about to see and open
 * her record" — so this is a searchable list of PEOPLE with their clinical
 * alerts and last visit, not a data grid of columns. Zero data leads straight
 * to the first-patient action (the first activation step).
 */
export default function Pacientes() {
  const t = useTranslations("product");
  const [patients, setPatients] = useState<PatientRow[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) {
        setPatients([]);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("id, full_name, alerts, consultations(started_at)")
        .order("full_name");

      setPatients(
        (data ?? []).map((row) => {
          const visits = (row.consultations as unknown as { started_at: string }[] | null) ?? [];
          const last = visits.map((v) => v.started_at).sort((a, b) => b.localeCompare(a))[0] ?? null;
          return {
            id: row.id as string,
            fullName: row.full_name as string,
            alerts: (row.alerts as { label: string }[] | null) ?? [],
            lastConsultation: last,
          };
        }),
      );
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!patients) return [];
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((patient) => patient.fullName.toLowerCase().includes(q));
  }, [patients, query]);

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
          {patients && patients.length > 0 && (
            <Button variant="contained" color="primary" href="/pacientes/novo" LinkComponent={Link}>
              {t("patients-new")}
            </Button>
          )}
        </Box>
      </Grid>

      <Grid size={12}>
        <Card component="section">
          <CardContent className="flex flex-col gap-4">
            {!patients ? (
              <Skeleton variant="rounded" height={220} className="rounded-3xl" />
            ) : patients.length === 0 ? (
              <EmptyState
                icon={<NiUsers />}
                title={t("patients-empty-title")}
                description={t("patients-empty-body")}
                action={{ label: t("patients-empty-cta"), href: "/pacientes/novo" }}
              />
            ) : (
              <>
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

                {filtered.length === 0 ? (
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
