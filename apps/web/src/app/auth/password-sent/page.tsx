"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Alert, AlertTitle, Box, Divider, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import NiCheckSquare from "@/icons/nexture/ni-check-square";

export default function Page() {
  const t = useTranslations("auth");

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameMobile="hidden" />
          </Box>

          <Box className="flex flex-col gap-10">
            <Typography variant="h1" component="h1" className="mb-2">
              {t("sent-title")}
            </Typography>

            <Alert severity="success" icon={<NiCheckSquare />} className="neutral bg-background-paper/60!">
              <AlertTitle variant="subtitle2">{t("sent-alert")}</AlertTitle>
              {t("sent-body")}
            </Alert>

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
