"use client";

import type { InvoiceRow } from "./use-billing";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { Box, Card, CardContent, Chip, Grid, Typography } from "@mui/material";

const INVOICE_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  paid: "success",
  open: "warning",
  failed: "error",
  refunded: "default",
  void: "default",
};

export default function InvoicesCard({ invoices }: { invoices: InvoiceRow[] }) {
  const t = useTranslations("product");
  const locale = useLocale();
  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent>
          <Typography variant="h5" component="h2" className="card-title">
            {t("billing-invoices-title")}
          </Typography>
          {!invoices.length ? (
            <Typography variant="body1" className="text-text-secondary">
              {t("billing-invoices-empty")}
            </Typography>
          ) : (
            <Box className="flex flex-col gap-3">
              {invoices.map((invoice) => (
                <Box key={invoice.id} className="flex flex-wrap items-center gap-3">
                  <Box className="min-w-0 flex-1">
                    <Typography variant="subtitle2" className="truncate">
                      {invoice.description ?? t("billing-payment")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {new Intl.DateTimeFormat(locale).format(new Date(invoice.paidAt ?? invoice.createdAt))}
                    </Typography>
                  </Box>
                  <Typography variant="subtitle2">
                    {new Intl.NumberFormat(locale, { style: "currency", currency: invoice.currency }).format(
                      invoice.amountCents / 100,
                    )}
                  </Typography>
                  <Chip
                    label={t(`billing-invoice-${invoice.status}` as never)}
                    size="small"
                    color={INVOICE_COLOR[invoice.status] ?? "default"}
                    variant="outlined"
                  />
                  {invoice.invoiceUrl && (
                    <Link
                      href={invoice.invoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="link-primary link-underline-hover text-sm"
                    >
                      {t("billing-view-invoice")}
                    </Link>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
