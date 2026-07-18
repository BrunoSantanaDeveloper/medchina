"use client";

import { useFormik } from "formik";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import * as Yup from "yup";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Tooltip,
  Typography,
} from "@mui/material";

import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import { createClient } from "@flyee/auth/client";

const InputErrorTooltip = ({ title }: { title: string }) => (
  <Tooltip title={title}>
    <span className="text-error ml-auto leading-4">
      <NiExclamationSquare size="small" />
    </span>
  </Tooltip>
);

export default function AccountCard() {
  const t = useTranslations("product");
  const [currentEmail, setCurrentEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"sent" | "error" | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<"saved" | "error" | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setCurrentEmail(data.user?.email ?? ""));
  }, []);

  const emailForm = useFormik({
    initialValues: { email: "" },
    validationSchema: Yup.object({
      email: Yup.string().email(t("settings-email-invalid")).required(t("settings-email-required")),
    }),
    validateOnBlur: false,
    validateOnMount: false,
    onSubmit: async (values, helpers) => {
      setEmailStatus(null);
      const { error } = await createClient().auth.updateUser({ email: values.email.trim() });
      setEmailStatus(error ? "error" : "sent");
      if (!error) helpers.resetForm();
    },
  });

  const passwordForm = useFormik({
    initialValues: { password: "", confirm: "" },
    validationSchema: Yup.object({
      password: Yup.string().min(8, t("settings-password-min")).required(t("settings-password-required")),
      confirm: Yup.string()
        .oneOf([Yup.ref("password")], t("settings-password-match"))
        .required(t("settings-confirm-required")),
    }),
    validateOnBlur: false,
    validateOnMount: false,
    onSubmit: async (values, helpers) => {
      setPasswordStatus(null);
      const { error } = await createClient().auth.updateUser({ password: values.password });
      setPasswordStatus(error ? "error" : "saved");
      if (!error) helpers.resetForm();
    },
  });

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent>
          <Typography variant="h5" component="h2" className="card-title">
            {t("settings-account-title")}
          </Typography>

          <Box component="form" onSubmit={emailForm.handleSubmit} className="mb-8 flex max-w-md flex-col gap-3">
            <Typography variant="subtitle2">{t("settings-signin-email")}</Typography>
            {emailStatus === "sent" && <Alert severity="success">{t("settings-email-confirmation")}</Alert>}
            {emailStatus === "error" && <Alert severity="error">{t("settings-save-error")}</Alert>}
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <Box className="flex items-center">
                <FormLabel component="label">{t("settings-new-email")}</FormLabel>
                {emailForm.touched.email && emailForm.errors.email && (
                  <InputErrorTooltip title={emailForm.errors.email} />
                )}
              </Box>
              <Input
                name="email"
                type="email"
                autoComplete="email"
                placeholder={currentEmail || "email@example.com"}
                value={emailForm.values.email}
                onChange={emailForm.handleChange}
                onBlur={emailForm.handleBlur}
              />
            </FormControl>
            <Box>
              <Button type="submit" variant="outlined" disabled={emailForm.isSubmitting}>
                {t("settings-change-email")}
              </Button>
            </Box>
          </Box>

          <Box component="form" onSubmit={passwordForm.handleSubmit} className="flex max-w-md flex-col gap-3">
            <Typography variant="subtitle2">{t("settings-password")}</Typography>
            {passwordStatus === "saved" && <Alert severity="success">{t("settings-password-saved")}</Alert>}
            {passwordStatus === "error" && <Alert severity="error">{t("settings-save-error")}</Alert>}
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <Box className="flex items-center">
                <FormLabel component="label">{t("settings-new-password")}</FormLabel>
                {passwordForm.touched.password && passwordForm.errors.password && (
                  <InputErrorTooltip title={passwordForm.errors.password} />
                )}
              </Box>
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                value={passwordForm.values.password}
                onChange={passwordForm.handleChange}
                onBlur={passwordForm.handleBlur}
              />
            </FormControl>
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <Box className="flex items-center">
                <FormLabel component="label">{t("settings-confirm-password")}</FormLabel>
                {passwordForm.touched.confirm && passwordForm.errors.confirm && (
                  <InputErrorTooltip title={passwordForm.errors.confirm} />
                )}
              </Box>
              <Input
                name="confirm"
                type="password"
                autoComplete="new-password"
                value={passwordForm.values.confirm}
                onChange={passwordForm.handleChange}
                onBlur={passwordForm.handleBlur}
              />
            </FormControl>
            <Box>
              <Button type="submit" variant="outlined" disabled={passwordForm.isSubmitting}>
                {t("settings-change-password")}
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}
