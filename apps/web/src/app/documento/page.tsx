import DocumentShareClient from "./document-share-client";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Card, CardContent, Typography } from "@mui/material";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return {
    title: t("document-share-meta-title"),
    description: t("document-share-meta-description"),
    // A bearer link to a health document: never indexed, never archived, and
    // no referrer so the token in the fragment cannot leak onward.
    robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    referrer: "no-referrer",
  };
}

/** Public, mobile-first: the patient opens this from WhatsApp or e-mail. */
export default function DocumentSharePage() {
  return (
    <Box component="main" className="flex min-h-screen flex-col items-center px-4 py-5 sm:py-10">
      <Box className="flex w-full max-w-xl flex-1 flex-col gap-5">
        <Box component="header" className="flex justify-center py-2">
          <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" />
        </Box>

        <Card className="w-full">
          <CardContent className="p-5! sm:p-7!">
            <DocumentShareClient />
          </CardContent>
        </Card>

        <Typography component="footer" variant="caption" className="text-text-primary px-2 text-center">
          {BRAND.name}
        </Typography>
      </Box>
    </Box>
  );
}
