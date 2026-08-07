"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import * as yup from "yup";

import { Alert, Autocomplete, Box, Button, CircularProgress, TextField, Typography } from "@mui/material";

import PracticeModalitiesField from "@/components/product/fields/practice-modalities-field";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { COMMON_TIMEZONES, isValidTimeZone, PRACTICE_MODALITIES, type PracticeModality } from "@/lib/practice-context";
import { createClient } from "@flyee/auth/client";

type PracticeContextResult = {
  ok?: boolean;
  timezone?: string;
  practice_modalities?: string[];
  timezone_confirmed_at?: string;
};

export default function PracticeContextForm({ onCompleted }: { onCompleted: () => void }) {
  const t = useTranslations("product");
  const { orgId, timezone, loading: orgLoading } = useCurrentOrg();
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  const validationSchema = yup.object({
    timezone: yup
      .string()
      .required(t("field-required"))
      .test("timezone", t("practice-context-timezone-invalid"), (value) => Boolean(value && isValidTimeZone(value))),
    modalities: yup.array().of(yup.string().oneOf([...PRACTICE_MODALITIES])),
  });

  const formik = useFormik({
    initialValues: { timezone, modalities: [] as PracticeModality[] },
    enableReinitialize: true,
    validationSchema,
    validateOnBlur: true,
    onSubmit: async (values) => {
      if (!orgId) {
        setServerError(t("no-workspace"));
        return;
      }
      setServerError(null);
      const { data, error } = await createClient().rpc("complete_practice_context", {
        target_org: orgId,
        target_timezone: values.timezone.trim(),
        target_modalities: values.modalities,
      });
      const result = data as PracticeContextResult | null;
      if (error || !result?.ok) {
        const code = error?.message;
        setServerError(
          code?.includes("invalid_timezone")
            ? t("practice-context-timezone-invalid")
            : code?.includes("invalid_modality")
              ? t("practice-context-modality-invalid")
              : t("practice-context-save-error"),
        );
        return;
      }
      window.dispatchEvent(new Event("medchina:organization-updated"));
      onCompleted();
    },
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setLoading(false);
        return;
      }
      const { data } = await supabase.from("profiles").select("practice_modalities").eq("id", user.id).maybeSingle();
      if (!active) return;
      const modalities = (data?.practice_modalities ?? []).filter((value: unknown): value is PracticeModality =>
        PRACTICE_MODALITIES.includes(value as PracticeModality),
      );
      formik.setValues({ timezone, modalities }, false);
      setLoading(false);
    };
    if (!orgLoading) void load();
    return () => {
      active = false;
    };
    // Formik is stable for this initialization and including it would reload on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgLoading, timezone]);

  if (loading || orgLoading) {
    return (
      <Box className="flex min-h-32 items-center justify-center" aria-live="polite">
        <CircularProgress size={24} aria-label={t("loading")} />
      </Box>
    );
  }

  return (
    <Box
      component="form"
      onSubmit={formik.handleSubmit}
      className="border-primary/30 bg-primary/5 flex flex-col gap-4 rounded-3xl border p-5"
    >
      <Box>
        <Typography variant="h6" component="h3">
          {t("practice-context-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("practice-context-body")}
        </Typography>
      </Box>

      <Autocomplete
        freeSolo
        autoSelect
        options={[...COMMON_TIMEZONES]}
        value={formik.values.timezone}
        onChange={(_, value) => formik.setFieldValue("timezone", value ?? "")}
        onInputChange={(_, value) => formik.setFieldValue("timezone", value)}
        onBlur={() => formik.setFieldTouched("timezone", true)}
        renderInput={(params) => (
          <TextField
            {...params}
            required
            label={t("practice-context-timezone")}
            helperText={
              formik.touched.timezone && formik.errors.timezone
                ? formik.errors.timezone
                : t("practice-context-timezone-help")
            }
            error={formik.touched.timezone && Boolean(formik.errors.timezone)}
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, required: true, "aria-required": true },
            }}
          />
        )}
      />

      {/* Shared with the settings card so the option list and labels cannot
          drift between the two places she can declare her scope. */}
      <PracticeModalitiesField
        value={formik.values.modalities}
        onChange={(value) => formik.setFieldValue("modalities", value)}
      />

      {serverError && <Alert severity="error">{serverError}</Alert>}

      <Button type="submit" variant="contained" className="self-start" disabled={formik.isSubmitting || !orgId}>
        {formik.isSubmitting ? <CircularProgress size={18} aria-label={t("saving")} /> : t("practice-context-save")}
      </Button>
    </Box>
  );
}
