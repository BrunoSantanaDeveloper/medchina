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
  FormControl,
  FormLabel,
  Grid,
  Input,
  TextField,
  Typography,
} from "@mui/material";

import { createClient } from "@flyee/auth/client";

const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Cuiaba",
  "America/Fortaleza",
  "America/Manaus",
  "America/Porto_Velho",
  "America/Recife",
  "Europe/Lisbon",
  "UTC",
];

export default function OrgGeneral({ org, onUpdated }: { org: OrgSummary; onUpdated: () => void }) {
  const t = useTranslations("product");
  const canManage = org.role === "owner" || org.role === "admin";
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(org.name);
    setTimezone(org.timezone);
    setStatus(null);
  }, [org.id, org.name, org.timezone]);

  const handleSave = async () => {
    const normalized = name.trim();
    const normalizedTimezone = timezone.trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: normalizedTimezone });
    } catch {
      setStatus("error");
      return;
    }
    if (normalized.length < 3 || !normalizedTimezone) {
      setStatus("error");
      return;
    }
    setSaving(true);
    setStatus(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_practice_settings", {
      target_org: org.id,
      target_name: normalized,
      target_timezone: normalizedTimezone,
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
        <CardContent>
          <Typography variant="h5" component="h2" className="card-title">
            {t("settings-practice-card-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary mb-5">
            {t("settings-practice-card-body")}
          </Typography>
          <Box className="flex max-w-lg flex-col">
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <FormLabel component="label">{t("settings-practice-name")}</FormLabel>
              <Input value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} />
            </FormControl>
            <Autocomplete
              freeSolo
              autoSelect
              options={COMMON_TIMEZONES}
              value={timezone}
              onChange={(_, value) => setTimezone(value ?? "")}
              onInputChange={(_, value) => setTimezone(value)}
              disabled={!canManage}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("settings-practice-timezone")}
                  helperText={t("settings-practice-timezone-help")}
                  error={!timezone}
                />
              )}
              className="mb-5"
            />
            {status === "error" && (
              <Alert severity="error" className="neutral bg-background-paper/60! mb-4">
                {t("settings-save-error")}
              </Alert>
            )}
            {status === "saved" && (
              <Alert severity="success" className="neutral bg-background-paper/60! mb-4">
                {t("settings-practice-saved")}
              </Alert>
            )}
            {canManage && (
              <Box>
                <Button variant="contained" onClick={handleSave} disabled={saving}>
                  {t("settings-save")}
                </Button>
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>
    </Grid>
  );
}
