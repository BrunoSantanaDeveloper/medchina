"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiUsers from "@/icons/nexture/ni-users";
import { getProductAction } from "@/lib/product-actions";

const NEW_PATIENT_HREF = getProductAction("new-patient").href;
const IMPORT_HREF = getProductAction("import-patients").href;

/**
 * The first-run home for a workspace with no patients yet, in the template's
 * illustrated banner layout (text left, illustration right, actions below).
 *
 * It is what the home shows before anyone is registered, so it carries the path
 * to value twice: register the first patient by hand, or bring the whole
 * practice in through the importer. Both lead to the same aha moment — the
 * first finalized consultation.
 *
 * It does not say "start here": the first thing a new account sees is the
 * preparation of the practice (`/onboarding`), and the order of the steps is
 * the checklist's to state. A banner that also claimed to be the beginning put
 * two "first steps" on the same screen for anyone who had skipped the
 * preparation.
 */
export default function HomeEmptyBanner() {
  const t = useTranslations("product");
  return (
    <Card component="section" className="h-full">
      <CardContent className="flex h-full flex-col items-start justify-between gap-6">
        <Box className="flex w-full flex-col md:flex-row">
          <Box className="w-full md:w-6/12 xl:w-8/12">
            <Typography variant="h4" component="h2" className="card-title">
              {t("home-empty-title")}
            </Typography>
            <Typography variant="body1" className="text-text-secondary text-center md:text-left xl:max-w-md">
              {t("home-empty-body")}
            </Typography>
          </Box>
          <Box className="flex w-full justify-center md:w-6/12 md:justify-end xl:w-4/12">
            <IllustrationLaunch className="text-primary h-64 w-full max-w-xs object-contain" />
          </Box>
        </Box>
        <Box className="flex flex-row flex-wrap gap-2">
          <Button
            size="medium"
            color="primary"
            variant="contained"
            startIcon={<NiUsers size="medium" />}
            href={NEW_PATIENT_HREF}
            LinkComponent={Link}
          >
            {t("home-empty-cta")}
          </Button>
          <Button
            size="medium"
            color="primary"
            variant="outlined"
            startIcon={<NiDownloadCloud size="medium" />}
            href={IMPORT_HREF}
            LinkComponent={Link}
          >
            {t("command-import-patients")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
