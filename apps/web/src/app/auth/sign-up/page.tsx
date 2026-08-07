"use client";
import { useFormik } from "formik";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  FormHelperText,
  FormLabel,
  Input,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";
import { DEFAULTS } from "@/config";
import NiCheck from "@/icons/nexture/ni-check";
import NiCross from "@/icons/nexture/ni-cross";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import { resolvePostAuthDestination } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { useThemeContext } from "@/theme/theme-provider";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { sanitizeInternalNext } from "@flyee/clinical";

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

/**
 * Free-account sign-up (PRD §6.3). `company` is the PRACTICE name — one
 * professional per workspace in the MVP — and it feeds the handle_new_user
 * trigger, which creates the profile plus the first organization.
 */
export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const [submitted, setSubmitted] = useState(false);
  const { isDarkMode } = useThemeContext();
  const prefillEmail = searchParams.get("email") ?? "";
  const requestedNext = searchParams.get("next");
  const next = requestedNext ? sanitizeInternalNext(requestedNext) : null;
  const joiningInvite = Boolean(next?.startsWith("/invite/"));
  const [serverError, setServerError] = useState<string | null>(null);

  const validationSchema = yup.object({
    name: yup
      .string()
      .required(t("field-required"))
      .min(3, t("field-min", { count: 3 })),
    email: yup.string().required(t("field-required")).email(t("field-email")),
    company: joiningInvite
      ? yup.string()
      : yup
          .string()
          .required(t("field-required"))
          .min(3, t("field-min", { count: 3 })),
    password: yup
      .string()
      .required(t("field-required"))
      .min(8, t("field-min", { count: 8 }))
      .test("uppercase", t("signup-password-case"), (value) => /[A-Z]/.test(value ?? "") && /[a-z]/.test(value ?? ""))
      .test("symbol", t("signup-password-symbol"), (value) => /[^A-Za-z 0-9]/g.test(value ?? "")),
  });

  const formik = useFormik({
    initialValues: { name: "", email: prefillEmail, company: "", password: "" },
    validationSchema,
    onSubmit: async (values) => {
      setServerError(null);
      if (!isSupabaseConfigured) {
        setServerError(t("not-configured"));
        return;
      }
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      if (next) callback.searchParams.set("next", next);
      // Invite recipients receive their single workspace only after explicit
      // acceptance. Everyone else gets a personal practice workspace here.
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: callback.toString(),
          data: { display_name: values.name, ...(!joiningInvite ? { company: values.company } : {}) },
        },
      });
      if (error) {
        setServerError(t("request-failed"));
        return;
      }
      if (data.session) {
        const destination = data.user ? await resolvePostAuthDestination(supabase, data.user.id) : DEFAULTS.appRoot;
        router.push(next ?? destination);
        router.refresh();
      } else {
        // Email confirmation is enabled on the Supabase project.
        router.push(`/auth/get-verification${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      }
    },
    validateOnBlur: false,
    validateOnMount: false,
  });

  const handleOAuth = async (provider: "google" | "github") => {
    setServerError(null);
    if (!isSupabaseConfigured) {
      setServerError(t("not-configured"));
      return;
    }
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    if (error) setServerError(t("request-failed"));
  };

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

  const googleSVG = () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M19.6169 10.2876C19.6169 9.60932 19.5561 8.95714 19.443 8.33105H10.4343V12.0354H15.5822C15.3561 13.2267 14.6778 14.2354 13.6604 14.9137V17.3224H16.7648C18.5735 15.6528 19.6169 13.2006 19.6169 10.2876Z"
        fill="#4285F4"
      />
      <path
        d="M10.4346 19.6346C13.0172 19.6346 15.1825 18.7825 16.7651 17.3216L13.6607 14.9129C12.8086 15.4868 11.7216 15.8346 10.4346 15.8346C7.94768 15.8346 5.83464 14.1564 5.07812 11.8955H1.89551V14.3651C3.46942 17.4868 6.69551 19.6346 10.4346 19.6346Z"
        fill="#34A853"
      />
      <path
        d="M5.07832 11.8866C4.88702 11.3127 4.77398 10.704 4.77398 10.0692C4.77398 9.4344 4.88702 8.8257 5.07832 8.25179V5.78223H1.89572C1.24354 7.06918 0.869629 8.52136 0.869629 10.0692C0.869629 11.617 1.24354 13.0692 1.89572 14.3561L4.37398 12.4257L5.07832 11.8866Z"
        fill="#FBBC05"
      />
      <path
        d="M10.4346 4.31358C11.8433 4.31358 13.0955 4.80054 14.0955 5.73967L16.8346 3.00054C15.1738 1.45271 13.0172 0.504883 10.4346 0.504883C6.69551 0.504883 3.46942 2.65271 1.89551 5.78314L5.07812 8.25271C5.83464 5.99184 7.94768 4.31358 10.4346 4.31358Z"
        fill="#EA4335"
      />
    </svg>
  );

  const githubSVG = () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 0.0693359C4.475 0.0693359 0 4.54434 0 10.0693C0 14.4943 2.8625 18.2318 6.8375 19.5568C7.3375 19.6443 7.525 19.3443 7.525 19.0818C7.525 18.8443 7.5125 18.0568 7.5125 17.2193C5 17.6818 4.35 16.6068 4.15 16.0443C4.0375 15.7568 3.55 14.8693 3.125 14.6318C2.775 14.4443 2.275 13.9818 3.1125 13.9693C3.9 13.9568 4.4625 14.6943 4.65 14.9943C5.55 16.5068 6.9875 16.0818 7.5625 15.8193C7.65 15.1693 7.9125 14.7318 8.2 14.4818C5.975 14.2318 3.65 13.3693 3.65 9.54434C3.65 8.45684 4.0375 7.55684 4.675 6.85684C4.575 6.60684 4.225 5.58184 4.775 4.20684C4.775 4.20684 5.6125 3.94434 7.525 5.23184C8.325 5.00684 9.175 4.89434 10.025 4.89434C10.875 4.89434 11.725 5.00684 12.525 5.23184C14.4375 3.93184 15.275 4.20684 15.275 4.20684C15.825 5.58184 15.475 6.60684 15.375 6.85684C16.0125 7.55684 16.4 8.44434 16.4 9.54434C16.4 13.3818 14.0625 14.2318 11.8375 14.4818C12.2 14.7943 12.5125 15.3943 12.5125 16.3318C12.5125 17.6693 12.5 18.7443 12.5 19.0818C12.5 19.3443 12.6875 19.6568 13.1875 19.5568C17.1375 18.2318 20 14.4818 20 10.0693C20 4.54434 15.525 0.0693359 10 0.0693359Z"
        fill={isDarkMode ? "#ffffff" : "#1B1F23"}
      />
    </svg>
  );

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </Box>

          <Box className="flex flex-col gap-10">
            <Box className="flex flex-col">
              <Typography variant="h1" component="h1" className="mb-2">
                {t("signup-title")}
              </Typography>
              <Typography variant="body1" className="text-text-primary">
                {t("signup-subtitle")}
              </Typography>
            </Box>

            <Box className="flex flex-col gap-5">
              <Box className="flex flex-col gap-2 md:flex-row">
                <Button
                  variant="outlined"
                  color="grey"
                  className="flex-none md:w-1/2"
                  onClick={() => handleOAuth("google")}
                >
                  <Box className="mr-2">{googleSVG()}</Box>
                  {t("google-signup")}
                </Button>
                <Button
                  variant="outlined"
                  color="grey"
                  className="flex-none md:w-1/2"
                  onClick={() => handleOAuth("github")}
                >
                  <Box className="mr-2">{githubSVG()}</Box>
                  {t("github-signup")}
                </Button>
              </Box>

              <Divider className="text-text-secondary my-0 text-sm">{t("or")}</Divider>

              <Box
                component="form"
                onSubmit={(event) => {
                  setSubmitted(true);
                  formik.handleSubmit(event);
                }}
                className="flex flex-col"
              >
                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="name" className="flex flex-row">
                    {t("name")}
                    {formik.touched.name && formik.errors.name && <InputErrorTooltip title={formik.errors.name} />}
                  </FormLabel>
                  <Input
                    id="name"
                    name="name"
                    autoComplete="name"
                    value={formik.values.name}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                </FormControl>

                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="email" className="flex flex-row">
                    {t("email")}
                    {formik.touched.email && formik.errors.email && <InputErrorTooltip title={formik.errors.email} />}
                  </FormLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={formik.values.email}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                </FormControl>

                {joiningInvite ? (
                  <Alert severity="info" className="neutral bg-background-paper/60! mb-4">
                    {t("invite-signup-body")}
                  </Alert>
                ) : (
                  <FormControl className="outlined" variant="standard" size="small">
                    <FormLabel component="label" htmlFor="company" className="flex flex-row">
                      {t("practice")}
                      {formik.touched.company && formik.errors.company && (
                        <InputErrorTooltip title={formik.errors.company} />
                      )}
                    </FormLabel>
                    <Input
                      id="company"
                      name="company"
                      value={formik.values.company}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                    />
                    <FormHelperText className="text-text-secondary">{t("practice-hint")}</FormHelperText>
                  </FormControl>
                )}

                <FormControl className="outlined" variant="standard" size="small">
                  <FormLabel component="label" htmlFor="password" className="flex flex-row">
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
                    <AlertTitle variant="subtitle2">{t("signup-failed")}</AlertTitle>
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
                  {t("continue")}
                </Button>

                <Typography variant="body2" className="text-text-secondary">
                  {t("legal-agree")}{" "}
                  <Link target="_blank" href="/legal/termos" className="link-primary link-underline-hover">
                    {t("legal-terms")}
                  </Link>{" "}
                  {t("legal-and")}{" "}
                  <Link target="_blank" href="/legal/privacidade" className="link-primary link-underline-hover">
                    {t("legal-privacy")}
                  </Link>
                  .
                </Typography>
              </Box>
            </Box>

            <Divider className="text-text-secondary my-0 text-sm"></Divider>
            <Box className="flex flex-col">
              <Typography variant="h6" component="h6">
                {t("signup-has-account-title")}
              </Typography>
              <Typography variant="body1" className="text-text-secondary">
                {t("signup-has-account-body", { brand: BRAND.name })}{" "}
                <Link
                  href={`/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                  className="link-primary link-underline-hover"
                >
                  {t("signup-has-account-link")}
                </Link>
                .
              </Typography>
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
