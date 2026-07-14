"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Card, CardContent, Grid, Skeleton, Switch, Typography } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { CONSENT_KINDS } from "@/lib/consents";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type TermRow = { id: string; slug: string; version: number };
type AcceptanceRow = { id: string; termId: string; slug: string; acceptedAt: string; revokedAt: string | null };

/**
 * Patient consents (PRD §9.5). The job: see what this patient has authorized
 * and change it, per purpose. Recording, AI processing and images are granted
 * SEPARATELY. Consent is never deleted — revoking stamps revoked_at, so the
 * history stays auditable (migration 0005 policy). Refusing recording never
 * blocks manual care.
 */
export default function ConsentimentosPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("product");
  const [patientName, setPatientName] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [acceptances, setAcceptances] = useState<AcceptanceRow[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    const [{ data: patient }, { data: termRows }, { data: acceptanceRows }] = await Promise.all([
      supabase.from("patients").select("full_name, org_id").eq("id", params.id).maybeSingle(),
      supabase.from("consent_terms").select("id, slug, version").eq("is_active", true),
      supabase
        .from("consent_acceptances")
        .select("id, term_id, accepted_at, revoked_at, consent_terms(slug)")
        .eq("subject_type", "patient")
        .eq("subject_id", params.id)
        .order("accepted_at", { ascending: false }),
    ]);

    if (patient) {
      setPatientName(patient.full_name);
      setOrgId(patient.org_id);
    }
    setTerms((termRows ?? []).map((row) => ({ id: row.id, slug: row.slug, version: row.version })));
    setAcceptances(
      (acceptanceRows ?? []).map((row) => {
        const term = row.consent_terms as unknown as { slug: string } | null;
        return {
          id: row.id,
          termId: row.term_id,
          slug: term?.slug ?? "",
          acceptedAt: row.accepted_at,
          revokedAt: row.revoked_at,
        };
      }),
    );
    setReady(true);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  // The current (non-revoked) acceptance for a slug, if any.
  const activeFor = (slug: string) => acceptances.find((a) => a.slug === slug && !a.revokedAt) ?? null;

  const toggle = async (slug: string, grant: boolean) => {
    if (!orgId || busy) return;
    setBusy(slug);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (grant) {
      const term = terms.find((row) => row.slug === slug);
      if (!term) {
        setError(t("consent-term-missing"));
        setBusy(null);
        return;
      }
      const { error: insertError } = await supabase.from("consent_acceptances").insert({
        term_id: term.id,
        org_id: orgId,
        subject_type: "patient",
        subject_id: params.id,
        recorded_by: user?.id ?? null,
      });
      if (insertError) setError(insertError.message);
      else
        recordAudit(supabase, "consent.granted", {
          orgId,
          entityType: "patient",
          entityId: params.id,
          metadata: { slug },
        });
    } else {
      const current = activeFor(slug);
      if (current) {
        const { error: updateError } = await supabase
          .from("consent_acceptances")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", current.id);
        if (updateError) setError(updateError.message);
        else
          recordAudit(supabase, "consent.revoked", {
            orgId,
            entityType: "patient",
            entityId: params.id,
            metadata: { slug },
          });
      }
    }
    await load();
    setBusy(null);
  };

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("consent-title")}
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            {t("home-breadcrumb")}
          </Link>
          <Link color="inherit" href="/pacientes">
            {t("patients-title")}
          </Link>
          <Link color="inherit" href={`/pacientes/${params.id}`}>
            {patientName ?? "…"}
          </Link>
          <Typography variant="body2">{t("consent-title")}</Typography>
        </Breadcrumbs>
      </Grid>

      {error && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        </Grid>
      )}

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-2">
            {!ready ? (
              <Skeleton variant="rounded" height={220} className="rounded-3xl" />
            ) : (
              CONSENT_KINDS.map((kind) => {
                const active = activeFor(kind.slug);
                return (
                  <Box
                    key={kind.slug}
                    className="border-grey-100 flex flex-row items-start gap-4 rounded-2xl border p-4"
                  >
                    <Box className="min-w-0 flex-1">
                      <Typography variant="body1" className="text-text-primary font-medium">
                        {t(kind.label)}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary leading-5">
                        {t(kind.hint)}
                      </Typography>
                      {active && (
                        <Typography
                          variant="body2"
                          className="text-accent-1-dark dark:text-accent-1-light mt-1 text-xs font-semibold"
                        >
                          {t("consent-granted-on", { date: new Date(active.acceptedAt).toLocaleDateString() })}
                        </Typography>
                      )}
                    </Box>
                    <Switch
                      checked={Boolean(active)}
                      disabled={busy === kind.slug}
                      onChange={(event) => toggle(kind.slug, event.target.checked)}
                    />
                  </Box>
                );
              })
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-2">
            <Typography variant="h6" component="h2">
              {t("consent-note-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("consent-note-body")}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
