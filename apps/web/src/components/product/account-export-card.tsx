"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from "@mui/material";

import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type AccountExport = {
  id: string;
  status: "pending" | "running" | "ready" | "failed" | "expired";
  patientCount: number | null;
  completedAt: string | null;
  expiresAt: string | null;
};

const IN_PROGRESS = ["pending", "running"];
const POLL_MS = 8000;

/**
 * Taking the whole practice away (PRD §9.10).
 *
 * It lives in the practice settings rather than under billing on purpose:
 * leaving is not a billing action, and putting it behind a plan — or behind a
 * cancellation flow — would make portability something we grant instead of
 * something she has.
 *
 * The archive expires, and the card says so before she asks for it: it is
 * every chart of her practice in plain text, and a link that never dies is a
 * second copy of the most sensitive data we hold.
 */
export default function AccountExportCard() {
  const t = useTranslations("product");
  const [latest, setLatest] = useState<AccountExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("account_exports")
      .select("id, status, patient_count, completed_at, expires_at")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (loadError) {
      setError(t("account-export-error"));
      setLoading(false);
      return;
    }
    setLatest(
      data
        ? {
            id: data.id as string,
            status: data.status as AccountExport["status"],
            patientCount: (data.patient_count as number | null) ?? null,
            completedAt: (data.completed_at as string | null) ?? null,
            expiresAt: (data.expires_at as string | null) ?? null,
          }
        : null,
    );
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // While the job runs she has nothing to do but wait; polling keeps the card
  // honest without asking her to reload the page.
  useEffect(() => {
    if (!latest || !IN_PROGRESS.includes(latest.status)) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [latest, load]);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/export", { method: "POST" });
      if (!response.ok) setError(t("account-export-error"));
    } catch {
      setError(t("account-export-error"));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const inProgress = latest !== null && IN_PROGRESS.includes(latest.status);
  const ready = latest?.status === "ready";

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-col gap-1">
          <Typography variant="h5" component="h2" className="card-title mb-0">
            {t("account-export-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("account-export-body")}
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        {loading ? (
          <CircularProgress size={20} />
        ) : inProgress ? (
          <Box className="flex flex-row items-center gap-3">
            <CircularProgress size={20} />
            <Box>
              <Typography variant="body2" className="text-text-primary">
                {t("account-export-preparing")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("account-export-preparing-hint")}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box className="flex flex-col gap-2">
            {ready && latest && (
              <>
                <Typography variant="body2" className="text-text-secondary">
                  {t("account-export-ready", { patients: latest.patientCount ?? 0 })}
                  {latest.expiresAt
                    ? ` · ${t("account-export-expires", { date: new Date(latest.expiresAt).toLocaleString() })}`
                    : ""}
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<NiDownloadCloud size="medium" />}
                  href={`/api/account/export/${latest.id}/download`}
                  className="self-start"
                >
                  {t("account-export-download")}
                </Button>
              </>
            )}

            {latest?.status === "failed" && <Alert severity="warning">{t("account-export-failed")}</Alert>}
            {latest?.status === "expired" && (
              <Typography variant="body2" className="text-text-secondary">
                {t("account-export-expired")}
              </Typography>
            )}

            <Button variant="text" color="grey" disabled={busy} onClick={request} className="self-start">
              {ready ? t("account-export-request-again") : t("account-export-request")}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
