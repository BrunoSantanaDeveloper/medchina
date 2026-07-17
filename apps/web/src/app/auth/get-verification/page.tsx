"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, AlertTitle, Box, Divider, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import NiEmailOpen from "@/icons/nexture/ni-email-open";
import { sanitizeInternalNext } from "@flyee/clinical";

/**
 * Where sign-up lands when the Supabase project requires email confirmation:
 * the account exists but has no session yet. Honest by design — it states what
 * happened and what to do, and never pretends to verify anything itself (the
 * template's version offered fake "send code to ****8714" options).
 */
export default function Page() {
  const t = useTranslations("auth");
  const requestedNext = useSearchParams().get("next");
  const next = requestedNext ? sanitizeInternalNext(requestedNext) : null;

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
                {t("get-verification-title")}
              </Typography>
            </Box>

            <Alert severity="info" icon={<NiEmailOpen />} className="neutral bg-background-paper/60!">
              <AlertTitle variant="subtitle2">{t("get-verification-title")}</AlertTitle>
              {t("get-verification-body")}
            </Alert>

            <Divider className="text-text-secondary my-0 text-sm"></Divider>
            <Typography variant="body1" className="text-text-secondary">
              <Link
                href={`/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                className="link-primary link-underline-hover"
              >
                {t("get-verification-back")}
              </Link>
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
