"use client";

import type { BillingProfile } from "./use-billing";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, TextField, Typography } from "@mui/material";

import { CepField, CpfCnpjField, PhoneField } from "@/components/product/fields";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import { createClient } from "@flyee/auth/client";
import { formatCep, formatCpfCnpj, formatPhoneBr, isValidCpfCnpj, onlyDigits } from "@flyee/fields";

/**
 * The fiscal identity the payment provider demands.
 *
 * Who: a professional about to subscribe. What she came to do: pay — not fill
 * a form. What success looks like: the shortest possible detour, taken once,
 * at the exact moment it blocks her.
 *
 * It lives HERE and not in the practice settings on purpose. Asaas rejects a
 * customer without `cpfCnpj`, so without this the checkout failed inside the
 * provider call and she was told "temporarily unavailable" — an error she
 * could neither understand nor fix. Collecting it where the block happens
 * keeps the purchase in one place instead of bouncing her across screens.
 *
 * Only the document is required; CEP, number and phone improve the invoice and
 * reduce anti-fraud friction, so they are asked for but never block.
 */
export default function BillingProfileCard({
  orgId,
  profile,
  required,
  onSaved,
}: {
  orgId: string;
  profile: BillingProfile;
  /** She just tried to buy and the document was missing — lead with the why. */
  required: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [document, setDocument] = useState(() => (profile.document ? formatCpfCnpj(profile.document) : ""));
  const [postalCode, setPostalCode] = useState(() => (profile.postalCode ? formatCep(profile.postalCode) : ""));
  const [addressNumber, setAddressNumber] = useState(profile.addressNumber ?? "");
  const [phone, setPhone] = useState(() => (profile.phone ? formatPhoneBr(profile.phone) : ""));
  const [status, setStatus] = useState<"saved" | "error" | "invalid" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDocument(profile.document ? formatCpfCnpj(profile.document) : "");
    setPostalCode(profile.postalCode ? formatCep(profile.postalCode) : "");
    setAddressNumber(profile.addressNumber ?? "");
    setPhone(profile.phone ? formatPhoneBr(profile.phone) : "");
    setStatus(null);
  }, [profile.document, profile.postalCode, profile.addressNumber, profile.phone]);

  const save = async () => {
    if (!isValidCpfCnpj(document)) {
      setStatus("invalid");
      return;
    }
    setSaving(true);
    setStatus(null);
    const supabase = createClient();
    // Digits, never the mask — the repo-wide rule for semantic fields, and the
    // format the provider expects.
    const { data, error } = await supabase.rpc("update_billing_profile", {
      target_org: orgId,
      target_cpf_cnpj: onlyDigits(document),
      target_postal_code: postalCode ? onlyDigits(postalCode) : null,
      target_address_number: addressNumber.trim() || null,
      target_phone: phone ? onlyDigits(phone) : null,
    });
    setSaving(false);
    if (error || (data as { ok?: boolean } | null)?.ok !== true) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    onSaved();
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-wrap items-center gap-2">
            <NiCreditCard size="medium" className="text-primary dark:text-primary-light" />
            <Typography variant="h5" component="h2" className="card-title mb-0">
              {t("billing-profile-title")}
            </Typography>
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {t("billing-profile-body")}
          </Typography>
          {required && <Alert severity="warning">{t("billing-profile-required")}</Alert>}
          <Grid container spacing={2.5} className="max-w-2xl">
            <Grid size={{ xs: 12, sm: 6 }}>
              <CpfCnpjField
                label={t("billing-profile-document")}
                value={document}
                onChange={(event) => setDocument(event.target.value)}
                invalidMessage={t("billing-profile-document-invalid")}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <PhoneField
                label={t("billing-profile-phone")}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                invalidMessage={t("billing-profile-phone-invalid")}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <CepField
                label={t("billing-profile-postal-code")}
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                invalidMessage={t("billing-profile-postal-code-invalid")}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t("billing-profile-address-number")}
                value={addressNumber}
                onChange={(event) => setAddressNumber(event.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
          </Grid>
          {status === "invalid" && <Alert severity="error">{t("billing-profile-document-invalid")}</Alert>}
          {status === "error" && <Alert severity="error">{t("settings-save-error")}</Alert>}
          {status === "saved" && <Alert severity="success">{t("billing-profile-saved")}</Alert>}
          <Box>
            <Button variant="contained" onClick={() => void save()} disabled={saving}>
              {t("settings-save")}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}
