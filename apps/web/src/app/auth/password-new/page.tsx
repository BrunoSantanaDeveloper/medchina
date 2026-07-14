"use client";
import { useFormik } from "formik";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import * as yup from "yup";

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Input,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";

import Logo from "@/components/logo/logo";
import { DEFAULTS } from "@/config";
import NiCheck from "@/icons/nexture/ni-check";
import NiCross from "@/icons/nexture/ni-cross";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

const InputErrorTooltip = ({ title }: { title: string }) => (
  <Box className="relative">
    <Tooltip title={title} arrow className="absolute -top-1.5">
      <Button
        startIcon={<NiCrossSquare size="small" />}
        color="error"
        size="small"
        className="group icon-only bg-transparent! outline-0!"
      ></Button>
    </Tooltip>
  </Box>
);

export default function Page() {
  const router = useRouter();
  const t = useTranslations("auth");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validationSchema = yup.object({
    password: yup
      .string()
      .required(t("field-required"))
      .min(8, t("field-min", { count: 8 }))
      .test("uppercase", t("signup-password-case"), (value) => /[A-Z]/.test(value ?? "") && /[a-z]/.test(value ?? ""))
      .test("symbol", t("signup-password-symbol"), (value) => /[^A-Za-z 0-9]/g.test(value ?? "")),
  });

  const formik = useFormik({
    initialValues: { password: "" },
    validationSchema,
    onSubmit: async (values) => {
      setServerError(null);
      if (!isSupabaseConfigured) {
        setServerError(t("not-configured"));
        return;
      }
      // The recovery link from the reset email lands here with a valid
      // session (via /auth/callback), so updateUser can set the password.
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) {
        setServerError(error.message);
        return;
      }
      router.push(DEFAULTS.appRoot);
      router.refresh();
    },
    validateOnBlur: false,
    validateOnMount: false,
  });

  const password = formik.values.password;
  const isLengthValid = password.length >= 8;
  const isCaseValid = /[A-Z]/.test(password) && /[a-z]/.test(password);
  const isSymbolValid = /[^A-Za-z 0-9]/g.test(password);

  const RuleMark = ({ ok }: { ok: boolean }) => (
    <span
      className={cn(
        "mx-1 inline-block h-4 w-4 rounded-md align-text-bottom",
        ok ? "bg-success text-text-contrast" : "bg-grey-100 text-text-secondary",
      )}
    >
      {ok ? <NiCheck size="tiny" /> : <NiCross size="tiny" />}
    </span>
  );

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameMobile="hidden" />
          </Box>

          <Box className="flex flex-col gap-10">
            <Box className="flex flex-col">
              <Typography variant="h1" component="h1" className="mb-2">
                {t("new-title")}
              </Typography>
              <Typography variant="body1" className="text-text-primary">
                {t("new-subtitle")}
              </Typography>
            </Box>

            <Box
              component="form"
              onSubmit={(event) => {
                setSubmitted(true);
                formik.handleSubmit(event);
              }}
              className="flex flex-col"
            >
              <FormControl className="outlined" variant="standard" size="small">
                <FormLabel component="label" className="flex flex-row">
                  {t("password")}
                  {formik.touched.password && formik.errors.password && (
                    <InputErrorTooltip title={formik.errors.password} />
                  )}
                </FormLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={formik.values.password}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                />
                <Typography variant="body2" className="text-text-secondary mt-2 inline-block align-middle">
                  <span className="inline">{t("signup-password-must")}</span>
                  <RuleMark ok={isLengthValid} />
                  <span className={cn("inline font-semibold", isLengthValid && "text-success")}>
                    {t("signup-password-length")}{" "}
                  </span>
                  <RuleMark ok={isCaseValid} />
                  <span className={cn("inline font-semibold", isCaseValid && "text-success")}>
                    {t("signup-password-case")}{" "}
                  </span>
                  <RuleMark ok={isSymbolValid} />
                  <span className={cn("inline font-semibold", isSymbolValid && "text-success")}>
                    {t("signup-password-symbol")}
                  </span>
                </Typography>
              </FormControl>

              {serverError && (
                <Alert severity="error" icon={<NiCrossSquare />} className="neutral bg-background-paper/60! mb-4">
                  <AlertTitle variant="subtitle2">{t("new-failed")}</AlertTitle>
                  <Typography variant="body2" className="text-text-primary">
                    {serverError}
                  </Typography>
                </Alert>
              )}
              {submitted && !formik.isValid && (
                <Alert severity="error" icon={<NiCrossSquare />} className="neutral bg-background-paper/60! mb-4">
                  <AlertTitle variant="subtitle2">{t("errors-title")}</AlertTitle>
                </Alert>
              )}

              <Button type="submit" variant="contained" className="mt-2 mb-4" disabled={formik.isSubmitting}>
                {t("new-submit")}
              </Button>
            </Box>

            <Divider className="text-text-secondary my-0 text-sm"></Divider>
            <Typography variant="body1" className="text-text-secondary">
              <Link href="/auth/sign-in" className="link-primary link-underline-hover">
                {t("sent-back")}
              </Link>
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
