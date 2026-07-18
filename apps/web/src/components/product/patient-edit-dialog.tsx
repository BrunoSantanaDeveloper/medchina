"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import * as yup from "yup";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";

import { CpfField, PhoneField } from "@/components/product/fields";
import NiPlus from "@/icons/nexture/ni-plus";
import { updatePatientDetails } from "@/lib/patients";
import { createClient } from "@flyee/auth/client";
import { isValidCpf, isValidPhoneBr, onlyDigits } from "@flyee/fields";

/** The editable demographic subset of the patient record. */
export type PatientEditData = {
  id: string;
  orgId: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
  document: string | null;
  email: string | null;
  notes: string | null;
  alerts: { label: string }[];
};

export default function PatientEditDialog({
  open,
  patient,
  onClose,
  onSaved,
}: {
  open: boolean;
  patient: PatientEditData;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("product");
  const [serverError, setServerError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<{ label: string }[]>(patient.alerts);
  const [alertDraft, setAlertDraft] = useState("");
  const todayIso = new Date().toISOString().slice(0, 10);

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: {
      fullName: patient.fullName,
      birthDate: patient.birthDate ?? "",
      phone: patient.phone ?? "",
      document: patient.document ?? "",
      email: patient.email ?? "",
      notes: patient.notes ?? "",
    },
    validationSchema: yup.object({
      fullName: yup
        .string()
        .trim()
        .min(3, t("field-min", { count: 3 }))
        .required(t("field-required")),
      birthDate: yup.string().test("past", t("patient-birth-future"), (value) => !value || value <= todayIso),
      phone: yup.string().test("phone", t("patient-phone-invalid"), (value) => !value || isValidPhoneBr(value)),
      document: yup.string().test("cpf", t("patient-document-invalid"), (value) => !value || isValidCpf(value)),
      email: yup.string().email(t("field-email")),
    }),
    onSubmit: async (values) => {
      setServerError(null);
      const changedFields = [
        values.fullName.trim() !== patient.fullName ? "fullName" : null,
        (values.birthDate || null) !== patient.birthDate ? "birthDate" : null,
        (onlyDigits(values.phone) || null) !== patient.phone ? "phone" : null,
        (onlyDigits(values.document) || null) !== patient.document ? "document" : null,
        (values.email.trim() || null) !== patient.email ? "email" : null,
        (values.notes.trim() || null) !== patient.notes ? "notes" : null,
        JSON.stringify(alerts) !== JSON.stringify(patient.alerts) ? "alerts" : null,
      ].filter((field): field is string => field !== null);

      if (changedFields.length === 0) {
        onClose();
        return;
      }

      const result = await updatePatientDetails(
        createClient(),
        {
          orgId: patient.orgId,
          patientId: patient.id,
          fullName: values.fullName,
          birthDate: values.birthDate,
          phone: values.phone,
          document: values.document,
          email: values.email,
          notes: values.notes,
          alerts,
        },
        changedFields,
      );
      if (!result.ok) {
        setServerError(t("patient-edit-error"));
        return;
      }
      await onSaved();
      onClose();
    },
  });

  // Re-seed the alert chips whenever the dialog (re)opens for a fresh edit.
  useEffect(() => {
    if (!open) return;
    setAlerts(patient.alerts);
    setAlertDraft("");
    setServerError(null);
  }, [open, patient.alerts]);

  const addAlert = () => {
    const value = alertDraft.trim();
    if (!value || alerts.some((alert) => alert.label === value)) return;
    setAlerts((current) => [...current, { label: value }]);
    setAlertDraft("");
  };

  return (
    <Dialog open={open} onClose={() => !formik.isSubmitting && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{t("patient-edit-title")}</DialogTitle>
      <DialogContent className="pt-2!">
        {/* Patient data, not the professional's own — keep browser autofill out. */}
        <Box
          component="form"
          id="patient-edit-form"
          onSubmit={formik.handleSubmit}
          autoComplete="off"
          noValidate
          className="flex flex-col gap-4"
        >
          <TextField
            required
            name="fullName"
            label={t("patient-name")}
            value={formik.values.fullName}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={formik.touched.fullName && Boolean(formik.errors.fullName)}
            helperText={formik.touched.fullName && formik.errors.fullName}
          />

          <Box className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="birthDate"
              label={t("patient-birth")}
              type="date"
              value={formik.values.birthDate}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={formik.touched.birthDate && Boolean(formik.errors.birthDate)}
              helperText={formik.touched.birthDate && formik.errors.birthDate}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso } }}
            />
            <PhoneField
              name="phone"
              label={t("patient-phone")}
              value={formik.values.phone}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              invalidMessage={t("patient-phone-invalid")}
            />
          </Box>

          <Box className="grid gap-4 sm:grid-cols-2">
            <CpfField
              name="document"
              label={t("patient-document")}
              value={formik.values.document}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              invalidMessage={t("patient-document-invalid")}
            />
            <TextField
              name="email"
              label={t("patient-email")}
              type="email"
              value={formik.values.email}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={formik.touched.email && Boolean(formik.errors.email)}
              helperText={formik.touched.email && formik.errors.email}
              slotProps={{ htmlInput: { inputMode: "email" } }}
            />
          </Box>

          <Box className="flex flex-col gap-2">
            <Box className="flex flex-row items-center gap-2">
              <TextField
                fullWidth
                label={t("patient-alerts")}
                placeholder={t("patient-alerts-placeholder")}
                value={alertDraft}
                onChange={(event) => setAlertDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addAlert();
                  }
                }}
                helperText={t("patient-alerts-hint")}
              />
              <IconButton onClick={addAlert} aria-label={t("patient-add-alert")} className="mb-5">
                <NiPlus size="small" />
              </IconButton>
            </Box>
            {alerts.length > 0 && (
              <Box className="flex flex-row flex-wrap gap-2">
                {alerts.map((alert) => (
                  <Chip
                    key={alert.label}
                    label={alert.label}
                    onDelete={() => setAlerts((current) => current.filter((item) => item.label !== alert.label))}
                  />
                ))}
              </Box>
            )}
          </Box>

          <TextField
            name="notes"
            label={t("patient-notes")}
            multiline
            minRows={3}
            value={formik.values.notes}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
          />

          {serverError && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {serverError}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button color="grey" onClick={onClose} disabled={formik.isSubmitting}>
          {t("cancel")}
        </Button>
        <Button type="submit" form="patient-edit-form" variant="contained" disabled={formik.isSubmitting}>
          {formik.isSubmitting ? t("saving") : t("patient-edit-save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
