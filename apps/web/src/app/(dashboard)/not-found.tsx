"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Typography } from "@mui/material";

export default function ProductNotFound() {
  const t = useTranslations("product");
  return (
    <Box className="mx-auto flex min-h-[50vh] max-w-xl flex-col justify-center gap-3 p-6">
      <Typography variant="h4" component="h1">
        {t("not-found-title")}
      </Typography>
      <Typography variant="body1" className="text-text-secondary">
        {t("not-found-body")}
      </Typography>
      <Button component={Link} href="/inicio" variant="contained" className="self-start">
        {t("not-found-home")}
      </Button>
    </Box>
  );
}
