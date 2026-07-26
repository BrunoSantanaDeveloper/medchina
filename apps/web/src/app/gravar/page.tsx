import MobileCaptureClient from "./mobile-capture-client";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Typography } from "@mui/material";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return {
    title: t("capture-public-meta-title"),
    description: t("capture-public-meta-description"),
    robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    referrer: "no-referrer",
  };
}

/**
 * Public, mobile-first, capture-ONLY page reached by scanning the QR shown in
 * the consultation sidebar (migration 0053). No login: the token in the URL
 * fragment is the credential, scoped to one consultation and audio only. It
 * cannot read the chart or reach any other patient.
 */
export default function GravarPage() {
  return (
    <Box component="main" className="flex min-h-screen flex-col items-center px-4 py-5 sm:py-10">
      <Box className="flex w-full max-w-md flex-1 flex-col gap-5">
        <Box component="header" className="flex justify-center py-2">
          <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" />
        </Box>

        <MobileCaptureClient />

        <Typography component="footer" variant="caption" className="text-text-primary px-2 text-center">
          {BRAND.name}
        </Typography>
      </Box>
    </Box>
  );
}
