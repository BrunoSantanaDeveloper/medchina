"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";

import { Alert, Box, Button, TextField, Typography } from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import { createQuickPatient, findPatientDuplicates, type PatientOption } from "@/lib/patients";
import { trackProductEvent } from "@/lib/product-events";
import { createClient } from "@flyee/auth/client";
import { isValidPhoneBr, onlyDigits } from "@flyee/fields";

export default function PatientQuickCreate({
  orgId,
  existingPatients,
  onCreated,
  onCancel,
  formId,
  embedded = false,
  onSubmittingChange,
}: {
  orgId: string;
  existingPatients: PatientOption[];
  onCreated: (patient: PatientOption) => void;
  onCancel: () => void;
  /**
   * EMBEDDED in a flow that owns the primary action (the guided onboarding's
   * wizard). The form keeps its fields, validation and duplicate check, and
   * drops its own heading and buttons: the wizard's primary button submits it
   * through `form={formId}`. Without this the step showed two "Voltar" buttons
   * and a disabled "Continuar" beside "Cadastrar e selecionar" — and the
   * heading said "você volta ao agendamento", written for the scheduling dialog.
   */
  formId?: string;
  embedded?: boolean;
  /** Lets the embedding flow show "saving" on ITS button. */
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const t = useTranslations("product");
  const [serverError, setServerError] = useState<string | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  const formik = useFormik({
    initialValues: { fullName: "", phone: "", birthDate: "" },
    validationSchema: yup.object({
      fullName: yup
        .string()
        .trim()
        .min(3, t("field-min", { count: 3 }))
        .required(t("field-required")),
      phone: yup.string().test("phone", t("patient-phone-invalid"), (value) => !value || isValidPhoneBr(value)),
      birthDate: yup.string().test("past", t("patient-birth-future"), (value) => !value || value <= todayIso),
    }),
    onSubmit: async (values) => {
      setServerError(null);
      const result = await createQuickPatient(createClient(), {
        orgId,
        fullName: values.fullName,
        phone: values.phone,
        birthDate: values.birthDate,
      });
      if (!result.ok) {
        setServerError(t("patient-quick-error"));
        return;
      }
      trackProductEvent("patient.created_inline", { origin: "schedule" });
      onCreated(result.data);
    },
  });

  const duplicates = useMemo(
    () => findPatientDuplicates(existingPatients, formik.values.fullName),
    [existingPatients, formik.values.fullName],
  );

  useEffect(() => {
    onSubmittingChange?.(formik.isSubmitting);
  }, [formik.isSubmitting, onSubmittingChange]);

  return (
    // Patient data, not the professional's own — keep browser autofill out.
    <Box
      component="form"
      id={formId}
      onSubmit={formik.handleSubmit}
      autoComplete="off"
      className="flex flex-col gap-4"
      noValidate
    >
      {!embedded && (
        <Box className="flex flex-col gap-1">
          <Typography variant="h6" component="h3">
            {t("patient-quick-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("patient-quick-body")}
          </Typography>
        </Box>
      )}

      <TextField
        autoFocus
        required
        name="fullName"
        label={t("patient-name")}
        value={formik.values.fullName}
        onChange={formik.handleChange}
        // Leaving the (auto-focused) field EMPTY is not an error yet — submit
        // still says "obrigatório". Flagging it on blur also pushed the buttons
        // below down mid-click: pressing "Voltar" blurred the field, the error
        // line appeared, and the release landed off the button.
        onBlur={(event) => {
          if (formik.values.fullName.trim()) formik.handleBlur(event);
        }}
        error={formik.touched.fullName && Boolean(formik.errors.fullName)}
        helperText={formik.touched.fullName && formik.errors.fullName}
      />

      {duplicates.length > 0 && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("patient-duplicate-warning", { count: duplicates.length })}
          <Box component="ul" className="mt-1 list-disc pl-5">
            {duplicates.slice(0, 3).map((patient) => (
              <li key={patient.id}>
                {patient.fullName}
                {patient.birthDate ? ` · ${new Date(`${patient.birthDate}T00:00:00`).toLocaleDateString()}` : ""}
                {patient.phone ? ` · ${patient.phone.slice(-4)}` : ""}
              </li>
            ))}
          </Box>
        </Alert>
      )}

      <PhoneField
        name="phone"
        label={t("patient-phone-optional")}
        value={formik.values.phone}
        onChange={formik.handleChange}
        onBlur={formik.handleBlur}
        invalidMessage={t("patient-phone-invalid")}
        helperText={
          formik.values.phone
            ? t("patient-phone-saved-digits", { count: onlyDigits(formik.values.phone).length })
            : undefined
        }
      />

      <TextField
        name="birthDate"
        label={t("patient-birth-optional")}
        type="date"
        value={formik.values.birthDate}
        onChange={formik.handleChange}
        onBlur={formik.handleBlur}
        error={formik.touched.birthDate && Boolean(formik.errors.birthDate)}
        helperText={formik.touched.birthDate && formik.errors.birthDate}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso } }}
      />

      {serverError && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {serverError}
        </Alert>
      )}

      {!embedded && (
        <Box className="flex flex-row justify-end gap-2">
          <Button type="button" color="grey" onClick={onCancel} disabled={formik.isSubmitting}>
            {t("back")}
          </Button>
          <Button type="submit" variant="contained" disabled={formik.isSubmitting || !formik.isValid}>
            {formik.isSubmitting ? t("saving") : t("patient-quick-save")}
          </Button>
        </Box>
      )}
    </Box>
  );
}
