"use client";

import { useFormik } from "formik";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import * as yup from "yup";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  Typography,
} from "@mui/material";

import { CpfField, PhoneField } from "@/components/product/fields";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import NiPlus from "@/icons/nexture/ni-plus";
import { recordAudit } from "@/lib/audit";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { isValidCpf, isValidPhoneBr, onlyDigits } from "@flyee/fields";

/** Native date input bound: a birth date is never in the future. */
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * First patient (PRD §9.4 + activation step 2). The job is "get this person
 * into the system in seconds so I can start the consultation" — so only the
 * name is required. Data minimization (PRD §14.4) is a product rule, not an
 * omission: document, birth date and contacts stay optional until a purpose
 * needs them. Clinical alerts are here because they must be visible before
 * every consultation.
 */
export default function NovoPaciente() {
  const router = useRouter();
  const t = useTranslations("product");
  const [serverError, setServerError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [alertDraft, setAlertDraft] = useState("");

  const validationSchema = yup.object({
    fullName: yup
      .string()
      .required(t("field-required"))
      .min(3, t("field-min", { count: 3 })),
    email: yup.string().email(t("field-email")),
    phone: yup.string().test("phone", t("patient-phone-invalid"), (value) => !value || isValidPhoneBr(value)),
    document: yup.string().test("cpf", t("patient-document-invalid"), (value) => !value || isValidCpf(value)),
    birthDate: yup.string().test("past", t("patient-birth-future"), (value) => !value || value <= todayIso()),
  });

  const formik = useFormik({
    initialValues: { fullName: "", birthDate: "", phone: "", email: "", document: "", notes: "" },
    validationSchema,
    validateOnBlur: false,
    onSubmit: async (values) => {
      setServerError(null);
      if (!isSupabaseConfigured) {
        setServerError(t("not-configured"));
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: membership } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("user_id", user?.id ?? "")
        .limit(1)
        .maybeSingle();
      if (!membership) {
        setServerError(t("no-workspace"));
        return;
      }

      const { data, error } = await supabase
        .from("patients")
        .insert({
          org_id: membership.org_id,
          full_name: values.fullName.trim(),
          birth_date: values.birthDate || null,
          phone: onlyDigits(values.phone) || null,
          document: onlyDigits(values.document) || null,
          email: values.email.trim() || null,
          notes: values.notes.trim() || null,
          alerts: alerts.map((label) => ({ label })),
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();

      if (error) {
        setServerError(t("patient-quick-error"));
        return;
      }

      recordAudit(supabase, "patient.created", {
        orgId: membership.org_id,
        entityType: "patient",
        entityId: data.id,
      });

      router.push(`/pacientes/${data.id}`);
      router.refresh();
    },
  });

  const addAlert = () => {
    const value = alertDraft.trim();
    if (!value || alerts.includes(value)) return;
    setAlerts((current) => [...current, value]);
    setAlertDraft("");
  };

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("patient-new-title")}
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            {t("home-breadcrumb")}
          </Link>
          <Link color="inherit" href="/pacientes">
            {t("patients-title")}
          </Link>
          <Typography variant="body2">{t("patient-new-title")}</Typography>
        </Breadcrumbs>
      </Grid>

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent>
            {/* This form describes the PATIENT: browser autofill would inject the
                professional's own contact data into the wrong person's record. */}
            <Box component="form" onSubmit={formik.handleSubmit} autoComplete="off" className="flex flex-col gap-1">
              <FormControl className="outlined" variant="standard" size="small" required>
                <FormLabel component="label" htmlFor="fullName">
                  {t("patient-name")}
                </FormLabel>
                <Input
                  id="fullName"
                  name="fullName"
                  value={formik.values.fullName}
                  onChange={formik.handleChange}
                  autoFocus
                  required
                  inputProps={{ "aria-required": true }}
                />
                {formik.touched.fullName && formik.errors.fullName && (
                  <FormHelperText className="text-error">{formik.errors.fullName}</FormHelperText>
                )}
              </FormControl>

              <Box className="grid gap-x-4 sm:grid-cols-2">
                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="birthDate">
                    {t("patient-birth")}
                  </FormLabel>
                  <Input
                    id="birthDate"
                    name="birthDate"
                    type="date"
                    inputProps={{ max: todayIso() }}
                    value={formik.values.birthDate}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                  {formik.touched.birthDate && formik.errors.birthDate && (
                    <FormHelperText className="text-error">{formik.errors.birthDate}</FormHelperText>
                  )}
                </FormControl>

                <PhoneField
                  name="phone"
                  label={t("patient-phone")}
                  value={formik.values.phone}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  invalidMessage={t("patient-phone-invalid")}
                />
              </Box>

              <Box className="grid gap-x-4 sm:grid-cols-2">
                <CpfField
                  name="document"
                  label={t("patient-document")}
                  value={formik.values.document}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  invalidMessage={t("patient-document-invalid")}
                />

                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="email">
                    {t("patient-email")}
                  </FormLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    inputProps={{ inputMode: "email" }}
                    value={formik.values.email}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                  {formik.touched.email && formik.errors.email && (
                    <FormHelperText className="text-error">{formik.errors.email}</FormHelperText>
                  )}
                </FormControl>
              </Box>

              <FormControl className="outlined" variant="standard" size="small">
                <FormLabel component="label" htmlFor="alertDraft">
                  {t("patient-alerts")}
                </FormLabel>
                <Box className="flex flex-row items-center gap-2">
                  <Input
                    id="alertDraft"
                    fullWidth
                    value={alertDraft}
                    placeholder={t("patient-alerts-placeholder")}
                    onChange={(event) => setAlertDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addAlert();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outlined"
                    color="grey"
                    className="icon-only flex-none"
                    onClick={addAlert}
                    aria-label={t("patient-add-alert")}
                  >
                    <NiPlus size="small" />
                  </Button>
                </Box>
                <FormHelperText className="text-text-secondary">{t("patient-alerts-hint")}</FormHelperText>
                {alerts.length > 0 && (
                  <Box className="mt-2 flex flex-row flex-wrap gap-2">
                    {alerts.map((alert) => (
                      <Chip
                        key={alert}
                        label={alert}
                        onDelete={() => setAlerts((current) => current.filter((item) => item !== alert))}
                      />
                    ))}
                  </Box>
                )}
              </FormControl>

              <FormControl className="outlined" variant="standard" size="small">
                <FormLabel component="label" htmlFor="notes">
                  {t("patient-notes")}
                </FormLabel>
                <Input
                  id="notes"
                  name="notes"
                  multiline
                  minRows={3}
                  value={formik.values.notes}
                  onChange={formik.handleChange}
                />
              </FormControl>

              {serverError && (
                <Alert severity="error" icon={<NiCrossSquare />} className="neutral bg-background-paper/60! my-3">
                  {serverError}
                </Alert>
              )}

              <Box className="mt-4 flex flex-row gap-2">
                <Button type="submit" variant="contained" color="primary" disabled={formik.isSubmitting}>
                  {t("patient-save")}
                </Button>
                <Button variant="text" color="grey" href="/pacientes" LinkComponent={Link}>
                  {t("cancel")}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-2">
            <Typography variant="h6" component="h2">
              {t("patient-privacy-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("patient-privacy-body")}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
