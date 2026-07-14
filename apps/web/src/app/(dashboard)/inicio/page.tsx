"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Breadcrumbs, Button, Card, CardContent, Grid, Skeleton, Typography } from "@mui/material";

import { TONE } from "@/components/marketing/tone";
import EmptyState from "@/components/product/empty-state";
import OnboardingChecklistCard from "@/components/product/onboarding-checklist-card";
import { useProfile } from "@/hooks/use-profile";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiUsers from "@/icons/nexture/ni-users";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type RecentConsultation = {
  id: string;
  status: string;
  startedAt: string;
  patientName: string;
  patientId: string;
};

type HomeData = {
  patients: number;
  finalized: number;
  drafts: RecentConsultation[];
  recent: RecentConsultation[];
};

/**
 * App home for the practitioner (PRD §9.2). The job here is NOT "browse a
 * table" — it is: pick up where I left off, and see what needs my attention.
 * So the screen leads with the open drafts (consultations waiting to be
 * finalized), then the recent activity, with the activation checklist on top
 * until the account is activated.
 *
 * Zero data is a first-run path to value (EmptyState), never a blank grid.
 */
export default function Inicio() {
  const t = useTranslations("product");
  const { displayName } = useProfile();
  const [data, setData] = useState<HomeData | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) {
        setData({ patients: 0, finalized: 0, drafts: [], recent: [] });
        return;
      }
      const supabase = createClient();
      const [patients, finalized, consultations] = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }),
        supabase.from("consultations").select("id", { count: "exact", head: true }).eq("status", "finalized"),
        supabase
          .from("consultations")
          .select("id, status, started_at, patients(id, full_name)")
          .order("started_at", { ascending: false })
          .limit(12),
      ]);

      const rows = (consultations.data ?? []).map((row) => {
        const patient = row.patients as unknown as { id: string; full_name: string } | null;
        return {
          id: row.id as string,
          status: row.status as string,
          startedAt: row.started_at as string,
          patientName: patient?.full_name ?? "—",
          patientId: patient?.id ?? "",
        };
      });

      setData({
        patients: patients.count ?? 0,
        finalized: finalized.count ?? 0,
        drafts: rows.filter((row) => row.status === "draft").slice(0, 5),
        recent: rows.filter((row) => row.status === "finalized").slice(0, 5),
      });
    };
    load();
  }, []);

  const greeting = displayName ? t("home-greeting", { name: displayName.split(" ")[0] }) : t("home-greeting-generic");

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          {greeting}
        </Typography>
        <Breadcrumbs>
          <Typography variant="body2">{t("home-breadcrumb")}</Typography>
        </Breadcrumbs>
      </Grid>

      <Grid size={12}>
        <OnboardingChecklistCard />
      </Grid>

      {!data ? (
        <Grid size={12}>
          <Skeleton variant="rounded" height={260} className="rounded-3xl" />
        </Grid>
      ) : data.patients === 0 ? (
        <Grid size={12}>
          <Card component="section">
            <CardContent>
              <EmptyState
                icon={<NiUsers />}
                title={t("home-empty-title")}
                description={t("home-empty-body")}
                action={{ label: t("home-empty-cta"), href: "/pacientes/novo" }}
              />
            </CardContent>
          </Card>
        </Grid>
      ) : (
        <>
          <Grid size={12}>
            <Box className="grid gap-4 sm:grid-cols-2">
              <Metric
                icon={<NiUsers />}
                tone="accent-2"
                value={data.patients}
                label={t("home-metric-patients")}
                href="/pacientes"
              />
              <Metric
                icon={<NiCheckSquare />}
                tone="accent-1"
                value={data.finalized}
                label={t("home-metric-finalized")}
                href="/pacientes"
              />
            </Box>
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <Card component="section" className="h-full">
              <CardContent className="flex flex-col gap-3">
                <Typography variant="h5" component="h2" className="card-title">
                  {t("home-drafts-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary -mt-2">
                  {t("home-drafts-subtitle")}
                </Typography>

                {data.drafts.length === 0 ? (
                  <EmptyState
                    icon={<NiClipboard />}
                    title={t("home-drafts-empty-title")}
                    description={t("home-drafts-empty-body")}
                    action={{ label: t("home-drafts-empty-cta"), href: "/pacientes" }}
                    className="border-none py-8"
                  />
                ) : (
                  <Box className="flex flex-col gap-1">
                    {data.drafts.map((draft) => (
                      <ConsultationRow key={draft.id} consultation={draft} label={t("home-open-draft")} />
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <Card component="section" className="h-full">
              <CardContent className="flex flex-col gap-3">
                <Typography variant="h5" component="h2" className="card-title">
                  {t("home-recent-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary -mt-2">
                  {t("home-recent-subtitle")}
                </Typography>

                {data.recent.length === 0 ? (
                  <Typography variant="body2" className="text-text-secondary py-6 text-center">
                    {t("home-recent-empty")}
                  </Typography>
                ) : (
                  <Box className="flex flex-col gap-1">
                    {data.recent.map((row) => (
                      <ConsultationRow key={row.id} consultation={row} label={t("home-open-record")} />
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </>
      )}
    </Grid>
  );
}

function Metric({
  icon,
  tone,
  value,
  label,
  href,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE;
  value: number;
  label: string;
  href: string;
}) {
  const toneStyle = TONE[tone];
  return (
    <Card component={Link} href={href} className="hover:shadow-darker-sm transition-shadow">
      <CardContent className="flex flex-row items-center gap-4">
        <span
          className={cn(
            "flex h-12 w-12 flex-none items-center justify-center rounded-2xl [&_svg]:h-6 [&_svg]:w-6",
            toneStyle.softBg,
            toneStyle.text,
          )}
        >
          {icon}
        </span>
        <Box>
          <Typography variant="h3" component="p" className="text-text-primary leading-none">
            {value}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {label}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

function ConsultationRow({ consultation, label }: { consultation: RecentConsultation; label: string }) {
  return (
    <Box className="hover:bg-grey-25 flex flex-row items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors">
      <Box className="min-w-0 flex-1">
        <Typography variant="body1" className="text-text-primary truncate font-medium">
          {consultation.patientName}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {new Date(consultation.startedAt).toLocaleDateString()}
        </Typography>
      </Box>
      <Button
        size="small"
        variant="text"
        color="primary"
        href={`/consultas/${consultation.id}`}
        LinkComponent={Link}
        className="flex-none"
      >
        {label}
      </Button>
    </Box>
  );
}
