"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Card, CardContent, Chip, Grid, Skeleton, Typography } from "@mui/material";

import ConsentCollectionDialog from "@/components/product/consent-collection-dialog";
import ConsentSheet, { type ConsentTerm } from "@/components/product/consent-sheet";
import { CONSENT_KINDS } from "@/lib/consents";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type AcceptanceRow = {
  id: string;
  termId: string;
  slug: string;
  acceptedAt: string;
  revokedAt: string | null;
  method: string | null;
};

type DomainResponse = { ok?: boolean; error?: { code?: string } };
type ConsentData = { patientName: string; terms: ConsentTerm[]; acceptances: AcceptanceRow[] };

export default function ConsentimentosPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("product");
  const [consentState, setConsentState] = useState<RemoteState<ConsentData, string>>(() => remoteLoading());
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [qrCollectionOpen, setQrCollectionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setConsentState(remoteLoading());
    setErrorKey(null);
    if (!isSupabaseConfigured) {
      setConsentState(remoteError("consent-load-error"));
      return;
    }

    const supabase = createClient();
    const [
      { data: patient, error: patientError },
      { data: termRows, error: termError },
      { data: acceptanceRows, error: acceptanceError },
    ] = await Promise.all([
      supabase.from("patients").select("full_name").eq("id", params.id).maybeSingle(),
      supabase
        .from("consent_terms")
        .select("id, slug, version, title, body")
        .eq("is_active", true)
        .order("version", { ascending: false }),
      supabase
        .from("consent_acceptances")
        .select("id, term_id, accepted_at, revoked_at, metadata, consent_terms(slug)")
        .eq("subject_type", "patient")
        .eq("subject_id", params.id)
        .order("accepted_at", { ascending: false }),
    ]);

    if (patientError || termError || acceptanceError || !patient) {
      setConsentState(remoteError("consent-load-error"));
      return;
    }

    const terms = (termRows ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      version: row.version,
      title: row.title,
      body: row.body,
    }));
    const acceptances = (acceptanceRows ?? []).map((row) => {
      const term = row.consent_terms as unknown as { slug: string } | null;
      return {
        id: row.id,
        termId: row.term_id,
        slug: term?.slug ?? "",
        acceptedAt: row.accepted_at,
        revokedAt: row.revoked_at,
        method:
          row.metadata && typeof row.metadata === "object" && "method" in row.metadata
            ? String(row.metadata.method)
            : null,
      };
    });
    setConsentState(remoteSuccess({ patientName: patient.full_name, terms, acceptances }));
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const consentData = consentState.status === "success" ? consentState.data : null;
  const patientName = consentData?.patientName ?? null;
  const terms = useMemo(() => consentData?.terms ?? [], [consentData]);
  const acceptances = useMemo(() => consentData?.acceptances ?? [], [consentData]);
  const termFor = useCallback((slug: string) => terms.find((term) => term.slug === slug) ?? null, [terms]);
  const activeFor = useCallback(
    (slug: string) => {
      const term = termFor(slug);
      if (!term) return null;
      return acceptances.find((acceptance) => acceptance.termId === term.id && !acceptance.revokedAt) ?? null;
    },
    [acceptances, termFor],
  );

  const selectedKind = useMemo(() => CONSENT_KINDS.find((kind) => kind.slug === selectedSlug) ?? null, [selectedSlug]);
  const selectedTerm = selectedSlug ? termFor(selectedSlug) : null;
  const selectedAcceptance = selectedSlug ? activeFor(selectedSlug) : null;

  const updateConsent = async (input: { granted: boolean; method: "verbal" | "in_person" }) => {
    if (!selectedSlug || busy) return;
    setBusy(true);
    setErrorKey(null);
    setSuccessKey(null);

    try {
      const response = await fetch(`/api/patients/${params.id}/consents/${selectedSlug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = (await response.json().catch(() => ({}))) as DomainResponse;
      if (!response.ok || !result.ok) {
        const code = result.error?.code;
        setErrorKey(code === "consent_term_missing" ? "consent-term-missing" : "consent-save-error");
        return;
      }

      setSuccessKey(input.granted ? "consent-granted-success" : "consent-revoked-success");
      setSelectedSlug(null);
      await load();
    } catch {
      setErrorKey("consent-save-error");
    } finally {
      setBusy(false);
    }
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

      {consentState.status === "error" && (
        <Grid size={12}>
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={load}>{t("retry")}</Button>}
          >
            {t(consentState.error)}
          </Alert>
        </Grid>
      )}
      {errorKey && consentState.status !== "error" && (
        <Grid size={12}>
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={load}>{t("retry")}</Button>}
          >
            {t(errorKey)}
          </Alert>
        </Grid>
      )}
      {successKey && (
        <Grid size={12}>
          <Alert severity="success" className="neutral bg-background-paper/60!">
            {t(successKey)}
          </Alert>
        </Grid>
      )}

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section" aria-labelledby="consent-list-title">
          <CardContent className="flex flex-col gap-3">
            <Box className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <Box>
                <Typography id="consent-list-title" variant="h5" component="h2">
                  {patientName ? t("consent-patient-title", { patient: patientName }) : t("consent-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("consent-list-subtitle")}
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="primary"
                onClick={() => setQrCollectionOpen(true)}
                disabled={consentState.status !== "success"}
                className="min-h-11 shrink-0 sm:self-start"
              >
                {t("consent-qr-open-action")}
              </Button>
            </Box>

            {consentState.status === "idle" || consentState.status === "loading" ? (
              <Skeleton variant="rounded" height={260} className="rounded-3xl" />
            ) : consentState.status === "error" || consentState.status === "empty" ? null : (
              CONSENT_KINDS.map((kind) => {
                const active = activeFor(kind.slug);
                const term = termFor(kind.slug);
                return (
                  <Box
                    key={kind.slug}
                    className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                  >
                    <Box className="min-w-0 flex-1">
                      <Box className="flex flex-wrap items-center gap-2">
                        <Typography variant="body1" className="text-text-primary font-medium">
                          {t(kind.label)}
                        </Typography>
                        <Chip
                          size="small"
                          color={active ? "success" : "default"}
                          label={t(active ? "consent-status-granted" : "consent-status-not-granted")}
                        />
                      </Box>
                      <Typography variant="body2" className="text-text-secondary mt-1 leading-5">
                        {t(kind.hint)}
                      </Typography>
                      <Typography variant="caption" className="text-text-secondary mt-1 block">
                        {active
                          ? t("consent-granted-version", {
                              date: new Date(active.acceptedAt).toLocaleDateString(),
                              version: term?.version ?? 0,
                            })
                          : term
                            ? t("consent-current-version", { version: term.version })
                            : t("consent-term-missing")}
                      </Typography>
                    </Box>
                    <Button variant={active ? "outlined" : "contained"} onClick={() => setSelectedSlug(kind.slug)}>
                      {t(active ? "consent-review-action" : "consent-grant-action")}
                    </Button>
                  </Box>
                );
              })
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Card component="aside">
          <CardContent className="flex flex-col gap-2">
            <Typography variant="h6" component="h2">
              {t("consent-note-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("consent-note-body")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("consent-manual-care-note")}
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      {selectedKind && (
        <ConsentSheet
          open={Boolean(selectedSlug)}
          label={t(selectedKind.label)}
          purpose={t(selectedKind.hint)}
          term={selectedTerm}
          active={Boolean(selectedAcceptance)}
          acceptedAt={selectedAcceptance?.acceptedAt}
          currentMethod={selectedAcceptance?.method}
          busy={busy}
          onClose={() => setSelectedSlug(null)}
          onSubmit={updateConsent}
        />
      )}

      <ConsentCollectionDialog
        open={qrCollectionOpen}
        patientId={params.id}
        patientName={patientName}
        onClose={() => setQrCollectionOpen(false)}
        onCompleted={load}
      />
    </Grid>
  );
}
