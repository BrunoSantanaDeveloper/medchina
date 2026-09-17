"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Grid,
  Skeleton,
  Typography,
} from "@mui/material";

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
 *
 * The same card holds the AREAS she follows (0103) — today only cycle and
 * fertility care. Modalities say HOW she treats; an area says WHAT she follows,
 * and declaring it is what makes the cycle/fertility block available for the
 * patients she marks.
 */
export default function PracticeScopeCard() {
  const t = useTranslations("product");
  const [modalities, setModalities] = useState<PracticeModality[]>([]);
  const [fertilityCare, setFertilityCare] = useState(false);
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
      .select("practice_modalities, practice_areas")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      // A failed READ is not an empty declaration: showing "nothing selected"
      // would invite her to save over a scope she never saw.
      setLoadFailed(true);
    } else {
      const stored = (data?.practice_modalities as string[] | null) ?? [];
      setModalities(PRACTICE_MODALITIES.filter((slug) => stored.includes(slug)));
      setFertilityCare(((data?.practice_areas as string[] | null) ?? []).includes("fertility"));
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
      const supabase = createClient();
      const [scope, areas] = await Promise.all([
        supabase.rpc("update_practice_modalities", { target_modalities: modalities }),
        supabase.rpc("update_practice_areas", { target_areas: fertilityCare ? ["fertility"] : [] }),
      ]);
      const saved = [scope, areas].every(
        (response) => !response.error && (response.data as { ok?: boolean } | null)?.ok,
      );
      setStatus(saved ? "saved" : "error");
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
              <Box className="flex flex-col gap-1">
                <Typography variant="subtitle2" component="h3">
                  {t("practice-areas-title")}
                </Typography>
                <FormControlLabel
                  className="items-start"
                  control={
                    <Checkbox
                      checked={fertilityCare}
                      disabled={saving}
                      onChange={(event) => setFertilityCare(event.target.checked)}
                      className="-mt-1"
                    />
                  }
                  label={
                    <Box className="flex flex-col">
                      <Typography variant="body2" className="text-text-primary">
                        {t("practice-area-fertility")}
                      </Typography>
                      <Typography variant="caption" className="text-text-secondary leading-5">
                        {t("practice-area-fertility-hint")}
                      </Typography>
                    </Box>
                  }
                />
              </Box>
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
