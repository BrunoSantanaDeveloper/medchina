"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
}: {
  orgId: string;
  existingPatients: PatientOption[];
  onCreated: (patient: PatientOption) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("product");
  const [serverError, setServerError] = useState<string | null>(null);

  const formik = useFormik({
    initialValues: { fullName: "", phone: "", birthDate: "" },
    validationSchema: yup.object({
      fullName: yup
        .string()
        .trim()
        .min(3, t("field-min", { count: 3 }))
        .required(t("field-required")),
      phone: yup.string().test("phone", t("patient-phone-invalid"), (value) => !value || isValidPhoneBr(value)),
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

  return (
    <Box component="form" onSubmit={formik.handleSubmit} className="flex flex-col gap-4" noValidate>
      <Box className="flex flex-col gap-1">
        <Typography variant="h6" component="h3">
          {t("patient-quick-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("patient-quick-body")}
        </Typography>
      </Box>

      <TextField
        autoFocus
        required
        name="fullName"
        label={t("patient-name")}
        value={formik.values.fullName}
        onChange={formik.handleChange}
        onBlur={formik.handleBlur}
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
        slotProps={{ inputLabel: { shrink: true } }}
      />

      {serverError && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {serverError}
        </Alert>
      )}

      <Box className="flex flex-row justify-end gap-2">
        <Button type="button" color="grey" onClick={onCancel} disabled={formik.isSubmitting}>
          {t("back")}
        </Button>
        <Button type="submit" variant="contained" disabled={formik.isSubmitting || !formik.isValid}>
          {formik.isSubmitting ? t("saving") : t("patient-quick-save")}
        </Button>
      </Box>
    </Box>
  );
}
