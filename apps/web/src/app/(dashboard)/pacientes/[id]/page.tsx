"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Card, CardContent, Grid, Skeleton, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import { recordAudit } from "@/lib/audit";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Patient = {
  id: string;
  orgId: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  alerts: { label: string }[];
};

type Visit = { id: string; status: string; startedAt: string; chiefComplaint: string | null };

/**
 * The patient's record (PRD §9.4/§9.7). The job is "prepare for the visit I'm
 * about to start": alerts first (they can change what I do), then the timeline
 * of what happened, and one unmistakable primary action — start the
 * consultation.
 */
export default function PacienteFicha() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("product");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    const [{ data: row }, { data: consultations }] = await Promise.all([
      supabase.from("patients").select("*").eq("id", params.id).maybeSingle(),
      supabase
        .from("consultations")
        .select("id, status, started_at, chief_complaint")
        .eq("patient_id", params.id)
        .order("started_at", { ascending: false }),
    ]);

    if (row) {
      setPatient({
        id: row.id,
        orgId: row.org_id,
        fullName: row.full_name,
        birthDate: row.birth_date,
        phone: row.phone,
        email: row.email,
        notes: row.notes,
        alerts: (row.alerts as { label: string }[] | null) ?? [],
      });
    }
    setVisits(
      (consultations ?? []).map((consultation) => ({
        id: consultation.id,
        status: consultation.status,
        startedAt: consultation.started_at,
        chiefComplaint: consultation.chief_complaint,
      })),
    );
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const startConsultation = async () => {
    if (!patient || starting) return;
    setStarting(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("consultations")
      .insert({
        org_id: patient.orgId,
        patient_id: patient.id,
        status: "draft",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      setError(insertError.message);
      setStarting(false);
      return;
    }
    recordAudit(supabase, "consultation.started", {
      orgId: patient.orgId,
      entityType: "consultation",
      entityId: data.id,
    });
    router.push(`/consultas/${data.id}`);
  };

  if (!patient) {
    return <Skeleton variant="rounded" height={320} className="rounded-3xl" />;
  }

  const openDraft = visits?.find((visit) => visit.status === "draft");

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h1" component="h1" className="mb-0">
              {patient.fullName}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("home-breadcrumb")}
              </Link>
              <Link color="inherit" href="/pacientes">
                {t("patients-title")}
              </Link>
              <Typography variant="body2">{patient.fullName}</Typography>
            </Breadcrumbs>
          </Box>

          {openDraft ? (
            <Button variant="contained" color="primary" href={`/consultas/${openDraft.id}`} LinkComponent={Link}>
              {t("patient-resume-consultation")}
            </Button>
          ) : (
            <Button variant="contained" color="primary" onClick={startConsultation} disabled={starting}>
              {t("patient-start-consultation")}
            </Button>
          )}
        </Box>
      </Grid>

      {/* Clinical alerts come before anything else (PRD §8.1). */}
      {patient.alerts.length > 0 && (
        <Grid size={12}>
          <Box className="flex flex-row flex-wrap gap-2">
            {patient.alerts.map((alert) => (
              <span
                key={alert.label}
                className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light rounded-full px-3 py-1.5 text-sm font-semibold"
              >
                {alert.label}
              </span>
            ))}
          </Box>
        </Grid>
      )}

      {error && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        </Grid>
      )}

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-3">
            <Typography variant="h5" component="h2" className="card-title">
              {t("patient-timeline-title")}
            </Typography>

            {!visits ? (
              <Skeleton variant="rounded" height={160} className="rounded-3xl" />
            ) : visits.length === 0 ? (
              <EmptyState
                icon={<NiClipboard />}
                title={t("patient-timeline-empty-title")}
                description={t("patient-timeline-empty-body")}
                action={{ label: t("patient-start-consultation"), onClick: startConsultation }}
                className="border-none py-8"
              />
            ) : (
              <Box className="flex flex-col gap-1">
                {visits.map((visit) => (
                  <Link
                    key={visit.id}
                    href={`/consultas/${visit.id}`}
                    className="hover:bg-grey-25 flex flex-row items-center gap-3 rounded-2xl px-3 py-3 transition-colors"
                  >
                    <Box className="min-w-0 flex-1">
                      <Typography variant="body1" className="text-text-primary truncate font-medium">
                        {visit.chiefComplaint || t("consultation-no-complaint")}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {new Date(visit.startedAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                    <StatusChip status={visit.status} label={t(`status-${visit.status}`)} />
                  </Link>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-3">
            <Typography variant="h5" component="h2" className="card-title">
              {t("patient-data-title")}
            </Typography>
            <Field label={t("patient-birth")} value={patient.birthDate ? formatDate(patient.birthDate) : null} />
            <Field label={t("patient-phone")} value={patient.phone} />
            <Field label={t("patient-email")} value={patient.email} />
            <Field label={t("patient-notes")} value={patient.notes} />
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString();

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <Box>
      <Typography variant="body2" className="text-text-secondary">
        {label}
      </Typography>
      <Typography variant="body1" className="text-text-primary">
        {value || "—"}
      </Typography>
    </Box>
  );
}

function StatusChip({ status, label }: { status: string; label: string }) {
  // Finalized = jade (done); everything else stays neutral. Red is reserved
  // for risk/failure (PRD §16.1), never for a normal draft.
  const style =
    status === "finalized"
      ? "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
      : "bg-grey-100 text-text-secondary";
  return <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}
