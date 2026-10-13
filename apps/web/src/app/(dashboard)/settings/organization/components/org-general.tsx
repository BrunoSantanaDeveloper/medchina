"use client";

import type { OrgSummary } from "./use-organization";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import { CepField, CpfCnpjField, PhoneField } from "@/components/product/fields";
import { COMMON_TIMEZONES, isValidTimeZone } from "@/lib/practice-context";
import { createClient } from "@flyee/auth/client";
import { BR_STATES, isValidBrState, isValidCep, isValidCpfCnpj, isValidPhoneBr, onlyDigits } from "@flyee/fields";

/** Same shape the database CHECK accepts — deliberately loose (0121). */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The clinic's identity: who it is, how a patient reaches it, where it is.
 *
 * The job on this screen is not "edit a record" — it is to make the practice
 * identifiable outside the app, on what she issues and to whoever needs to call
 * her. That is why telefone, e-mail, cidade and UF are required HERE and not in
 * the column: accounts that predate this screen stay usable, and the demand
 * lands on whoever opens the form (migration 0121).
 *
 * Not the billing profile. That one lives in /settings/billing and may carry a
 * different document on purpose — the charge can come out on the professional's
 * CPF while the prescription carries the clinic's CNPJ. Neither reads the other.
 */
export default function OrgGeneral({ org, onUpdated }: { org: OrgSummary; onUpdated: () => void }) {
  const t = useTranslations("product");
  const canManage = org.role === "owner" || org.role === "admin";

  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [document, setDocument] = useState(org.document ?? "");
  const [phone, setPhone] = useState(org.phone ?? "");
  const [email, setEmail] = useState(org.email ?? "");
  const [postalCode, setPostalCode] = useState(org.postalCode ?? "");
  const [street, setStreet] = useState(org.street ?? "");
  const [number, setNumber] = useState(org.number ?? "");
  const [complement, setComplement] = useState(org.complement ?? "");
  const [district, setDistrict] = useState(org.district ?? "");
  const [city, setCity] = useState(org.city ?? "");
  const [state, setState] = useState(org.state ?? "");

  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(org.name);
    setTimezone(org.timezone);
    setDocument(org.document ?? "");
    setPhone(org.phone ?? "");
    setEmail(org.email ?? "");
    setPostalCode(org.postalCode ?? "");
    setStreet(org.street ?? "");
    setNumber(org.number ?? "");
    setComplement(org.complement ?? "");
    setDistrict(org.district ?? "");
    setCity(org.city ?? "");
    setState(org.state ?? "");
    setSubmitted(false);
    setStatus(null);
  }, [org]);

  // Emptiness is only worth shouting about after she has tried to save — the
  // semantic fields already flag a complete-but-invalid value as she types.
  const missing = {
    name: name.trim().length < 3,
    timezone: !isValidTimeZone(timezone.trim()),
    phone: !isValidPhoneBr(phone),
    email: !EMAIL_SHAPE.test(email.trim()),
    city: city.trim().length === 0,
    state: !isValidBrState(state),
  };
  const invalidOptional = {
    document: document.trim().length > 0 && !isValidCpfCnpj(document),
    postalCode: postalCode.trim().length > 0 && !isValidCep(postalCode),
  };
  const blocked = Object.values(missing).some(Boolean) || Object.values(invalidOptional).some(Boolean);
  const show = (field: keyof typeof missing) => submitted && missing[field];

  const handleSave = async () => {
    setSubmitted(true);
    setStatus(null);
    if (blocked) return;

    setSaving(true);
    const supabase = createClient();
    // Digits, never the mask — the repo-wide rule for semantic fields.
    const { data, error } = await supabase.rpc("update_practice_settings", {
      target_org: org.id,
      target_name: name.trim(),
      target_timezone: timezone.trim(),
      target_document: document ? onlyDigits(document) : null,
      target_phone: onlyDigits(phone),
      target_email: email.trim(),
      target_postal_code: postalCode ? onlyDigits(postalCode) : null,
      target_street: street.trim() || null,
      target_number: number.trim() || null,
      target_complement: complement.trim() || null,
      target_district: district.trim() || null,
      target_city: city.trim(),
      target_state: state,
    });
    setSaving(false);

    const result = data as { ok?: boolean } | null;
    if (error || !result?.ok) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    onUpdated();
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Box>
            <Typography variant="h5" component="h2" className="card-title">
              {t("settings-practice-card-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("settings-practice-card-body")}
            </Typography>
          </Box>

          <Grid container spacing={2.5} className="max-w-3xl">
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField
                label={t("settings-practice-name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canManage}
                error={show("name")}
                helperText={show("name") ? t("field-required") : undefined}
                required
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <CpfCnpjField
                label={t("settings-practice-document")}
                value={document}
                onChange={(event) => setDocument(event.target.value)}
                invalidMessage={t("settings-practice-document-invalid")}
                helperText={t("settings-practice-document-help")}
                disabled={!canManage}
                fullWidth
                size="small"
              />
            </Grid>

            <Grid size={12}>
              <Typography variant="subtitle2" component="h3" className="mt-2">
                {t("settings-practice-contact-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("settings-practice-contact-help")}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <PhoneField
                label={t("settings-practice-phone")}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                invalidMessage={t("settings-practice-phone-invalid")}
                disabled={!canManage}
                error={show("phone")}
                helperText={show("phone") ? t("field-required") : undefined}
                required
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t("settings-practice-email")}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!canManage}
                error={show("email")}
                helperText={show("email") ? t("field-email") : undefined}
                required
                fullWidth
                size="small"
              />
            </Grid>

            <Grid size={12}>
              <Typography variant="subtitle2" component="h3" className="mt-2">
                {t("settings-practice-address-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("settings-practice-address-help")}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <CepField
                label={t("settings-practice-postal-code")}
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                invalidMessage={t("settings-practice-postal-code-invalid")}
                disabled={!canManage}
                // Pre-fills the siblings and nothing more: every one of them
                // stays editable, because a lookup can be stale or wrong and
                // must never become a lock (packages/fields contract).
                onAddressFound={(address) => {
                  setStreet((current) => address.street || current);
                  setDistrict((current) => address.district || current);
                  setCity((current) => address.city || current);
                  setState((current) => address.state || current);
                }}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label={t("settings-practice-street")}
                value={street}
                onChange={(event) => setStreet(event.target.value)}
                disabled={!canManage}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label={t("settings-practice-number")}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                disabled={!canManage}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label={t("settings-practice-complement")}
                value={complement}
                onChange={(event) => setComplement(event.target.value)}
                disabled={!canManage}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                label={t("settings-practice-district")}
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
                disabled={!canManage}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label={t("settings-practice-city")}
                value={city}
                onChange={(event) => setCity(event.target.value)}
                disabled={!canManage}
                error={show("city")}
                helperText={show("city") ? t("field-required") : undefined}
                required
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label={t("settings-practice-state")}
                value={state}
                onChange={(event) => setState(event.target.value)}
                disabled={!canManage}
                error={show("state")}
                helperText={show("state") ? t("field-required") : undefined}
                required
                fullWidth
                size="small"
              >
                {BR_STATES.map((uf) => (
                  <MenuItem key={uf} value={uf}>
                    {uf}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid size={12}>
              <Autocomplete
                freeSolo
                autoSelect
                options={[...COMMON_TIMEZONES]}
                value={timezone}
                onChange={(_, value) => setTimezone(value ?? "")}
                onInputChange={(_, value) => setTimezone(value)}
                disabled={!canManage}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t("settings-practice-timezone")}
                    helperText={t("settings-practice-timezone-help")}
                    error={show("timezone")}
                    size="small"
                  />
                )}
              />
            </Grid>
          </Grid>

          {status === "error" && <Alert severity="error">{t("settings-save-error")}</Alert>}
          {submitted && blocked && <Alert severity="warning">{t("settings-practice-incomplete")}</Alert>}
          {status === "saved" && <Alert severity="success">{t("settings-practice-saved")}</Alert>}

          {canManage && (
            <Box>
              <Button variant="contained" onClick={handleSave} disabled={saving}>
                {t("settings-save")}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
