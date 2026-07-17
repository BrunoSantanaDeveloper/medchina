import PatientConsentForm from "./patient-consent-form";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Card, CardContent, Typography } from "@mui/material";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return {
    title: t("consent-public-meta-title"),
    description: t("consent-public-meta-description"),
    robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    referrer: "no-referrer",
  };
}

/** Public, mobile-first bearer flow. The token lives only in the URL fragment. */
export default function ConsentirPage() {
  return (
    <Box component="main" className="flex min-h-screen flex-col items-center px-4 py-5 sm:py-10">
      <Box className="flex w-full max-w-xl flex-1 flex-col gap-5">
        <Box component="header" className="flex justify-center py-2">
          <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" />
        </Box>

        <Card className="w-full">
          <CardContent className="p-5! sm:p-7!">
            <PatientConsentForm />
          </CardContent>
        </Card>

        <Typography component="footer" variant="caption" className="text-text-primary px-2 text-center">
          {/* This is intentionally general: no patient or consultation data is exposed outside the card. */}
          {BRAND.name}
        </Typography>
      </Box>
    </Box>
  );
}
