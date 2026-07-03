"use client";

import { CreditRow, formatMoney, InvoiceRow } from "./use-billing";
import Link from "next/link";

import { Box, Card, CardContent, Chip, Grid, Typography } from "@mui/material";

const INVOICE_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  paid: "success",
  open: "warning",
  failed: "error",
  refunded: "default",
  void: "default",
};

type Props = {
  invoices: InvoiceRow[];
  credits: CreditRow[];
};

export default function InvoicesCard({ invoices, credits }: Props) {
  return (
    <>
      <Grid size={{ xs: 12, lg: 7 }}>
        <Card component="section" className="h-full">
          <CardContent>
            <Typography variant="h5" component="h5" className="card-title">
              Invoices
            </Typography>
            {invoices.length === 0 ? (
              <Typography variant="body1" className="text-text-secondary">
                No invoices yet.
              </Typography>
            ) : (
              <Box className="flex flex-col gap-3">
                {invoices.map((invoice) => (
                  <Box key={invoice.id} className="flex flex-row items-center gap-3">
                    <Box className="flex min-w-0 grow flex-col">
                      <Typography variant="subtitle2" className="truncate">
                        {invoice.description ?? "Payment"}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {new Date(invoice.paidAt ?? invoice.createdAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                    <Typography variant="subtitle2">{formatMoney(invoice.amountCents, invoice.currency)}</Typography>
                    <Chip
                      label={invoice.status}
                      size="small"
                      color={INVOICE_COLOR[invoice.status] ?? "default"}
                      variant="outlined"
                      className="capitalize"
                    />
                    {invoice.invoiceUrl && (
                      <Link
                        href={invoice.invoiceUrl}
                        target="_blank"
                        className="link-primary link-underline-hover text-sm"
                      >
                        View
                      </Link>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 5 }}>
        <Card component="section" className="h-full">
          <CardContent>
            <Typography variant="h5" component="h5" className="card-title">
              Credit activity
            </Typography>
            {credits.length === 0 ? (
              <Typography variant="body1" className="text-text-secondary">
                No credit activity yet.
              </Typography>
            ) : (
              <Box className="flex flex-col gap-3">
                {credits.map((tx) => (
                  <Box key={tx.id} className="flex flex-row items-center gap-3">
                    <Box className="flex min-w-0 grow flex-col">
                      <Typography variant="subtitle2" className="truncate">
                        {tx.description ?? tx.kind}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {new Date(tx.createdAt).toLocaleDateString()}
                        {tx.expiresAt ? ` — expires ${new Date(tx.expiresAt).toLocaleDateString()}` : ""}
                      </Typography>
                    </Box>
                    <Typography variant="subtitle2" className={tx.amount >= 0 ? "text-success" : "text-error"}>
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </>
  );
}
