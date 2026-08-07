"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, Grid, Skeleton, Typography } from "@mui/material";

import PracticeModalitiesField from "@/components/product/fields/practice-modalities-field";
import { PRACTICE_MODALITIES, type PracticeModality } from "@/lib/practice-context";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * "O que eu trato" — her scope of practice, editable for the first time
 * outside onboarding.
 *
 * The job on this card: a professional whose practice CHANGED (she starts
 * doing cupping, she drops moxibustion) makes the product follow her. Until
 * now the declaration was write-once — the onboarding form disappears the
 * moment the timezone is confirmed — so a stale scope silently narrowed the
 * therapeutic plan she is offered, with nowhere to fix it.
 *
 * Success is one edit and a confirmation, so the card says plainly what the
 * declaration DOES (bounds the plan, orients the library) instead of leaving
 * her to guess whether it matters.
 *
 * Declaring nothing is a legitimate answer, not an empty state: it means "no
 * restriction", and the plan then offers every modality. That is why there is
 * no EmptyState here and no nudge to fill it — an unfilled scope is already a
 * working configuration.
 */
export default function PracticeScopeCard() {
  const t = useTranslations("product");
  const [modalities, setModalities] = useState<PracticeModality[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadFailed(false);
    if (!isSupabaseConfigured) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("practice_modalities")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      // A failed READ is not an empty declaration: showing "nothing selected"
      // would invite her to save over a scope she never saw.
      setLoadFailed(true);
    } else {
      const stored = (data?.practice_modalities as string[] | null) ?? [];
      setModalities(PRACTICE_MODALITIES.filter((slug) => stored.includes(slug)));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setStatus(null);
    setSaving(true);
    try {
      const { data, error } = await createClient().rpc("update_practice_modalities", {
        target_modalities: modalities,
      });
      const result = data as { ok?: boolean } | null;
      setStatus(error || !result?.ok ? "error" : "saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent>
          <Typography variant="h5" component="h2" className="card-title">
            {t("practice-scope-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary mb-4 leading-6">
            {t("practice-scope-hint")}
          </Typography>

          {status === "saved" && (
            <Alert severity="success" className="neutral bg-background-paper/60! mb-4">
              {t("practice-scope-saved")}
            </Alert>
          )}
          {status === "error" && (
            <Alert severity="error" className="neutral bg-background-paper/60! mb-4">
              {t("practice-scope-error")}
            </Alert>
          )}

          {loading ? (
            <Skeleton variant="rounded" height={56} />
          ) : loadFailed ? (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={<Button onClick={() => void load()}>{t("retry")}</Button>}
            >
              {t("practice-scope-load-error")}
            </Alert>
          ) : (
            <Box className="flex flex-col gap-4">
              <PracticeModalitiesField
                value={modalities}
                onChange={setModalities}
                disabled={saving}
                label={t("practice-scope-field")}
                helperText={t("practice-scope-field-help")}
              />
              <Button
                variant="contained"
                color="primary"
                className="self-start"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? <CircularProgress size={18} aria-label={t("saving")} /> : t("save")}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
