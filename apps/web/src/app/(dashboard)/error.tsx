"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

export default function ProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("product");

  useEffect(() => {
    // The digest is safe operational context; never emit message/stack because
    // a provider error could contain identifiers or clinical payloads.
    console.error("product_boundary", { digest: error.digest ?? "unavailable" });
  }, [error.digest]);

  return (
    <Box className="mx-auto flex min-h-[50vh] max-w-xl flex-col justify-center gap-4 p-6">
      <Typography variant="h4" component="h1">
        {t("product-error-title")}
      </Typography>
      <Alert severity="error">{t("product-error-body")}</Alert>
      <Button variant="contained" onClick={reset} className="self-start">
        {t("retry")}
      </Button>
    </Box>
  );
}
