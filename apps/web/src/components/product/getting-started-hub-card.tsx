"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiPath from "@/icons/nexture/ni-path";
import { getProductAction } from "@/lib/product-actions";
import { cn } from "@/lib/utils";

const GETTING_STARTED_HREF = getProductAction("getting-started").href;

/** Permanent Home entry point for replaying or switching any start track. */
export default function GettingStartedHubCard({ className }: { className?: string }) {
  const t = useTranslations("product");
  return (
    <Card component="section" className={cn(className)}>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Box className="flex items-start gap-3">
          <span className="bg-primary/10 text-primary flex h-11 w-11 flex-none items-center justify-center rounded-2xl">
            <NiPath size="medium" />
          </span>
          <Box>
            <Typography variant="h5" component="h2" className="card-title">
              {t("getting-started-hub-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("getting-started-hub-body")}
            </Typography>
          </Box>
        </Box>
        <Button
          variant="outlined"
          LinkComponent={Link}
          href={GETTING_STARTED_HREF}
          endIcon={<NiChevronRightSmall size="small" />}
          className="flex-none"
        >
          {t("getting-started-hub-cta")}
        </Button>
      </CardContent>
    </Card>
  );
}
