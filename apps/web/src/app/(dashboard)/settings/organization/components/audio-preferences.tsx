"use client";

import type { AudioRetentionPolicy, OrgSummary } from "./use-organization";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import { createClient } from "@flyee/auth/client";

const POLICIES: AudioRetentionPolicy[] = ["after_validation", "thirty_days", "manual"];

export default function AudioPreferences({ org, onUpdated }: { org: OrgSummary; onUpdated: () => void }) {
  const t = useTranslations("product");
  const canManage = org.role === "owner" || org.role === "admin";
  const [policy, setPolicy] = useState<AudioRetentionPolicy>(org.audioRetention);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPolicy(org.audioRetention);
    setStatus(null);
  }, [org.audioRetention, org.id]);

  const save = async () => {
    if (!canManage || saving) return;
    setSaving(true);
    setStatus(null);
    const { data, error } = await createClient().rpc("set_audio_retention_policy", {
      target_org: org.id,
      target_policy: policy,
    });
    const result = data as { ok?: boolean } | null;
    setSaving(false);
    if (error || !result?.ok) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    onUpdated();
  };

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-4">
        <Box>
          <Typography variant="h5" component="h2" className="card-title">
            {t("settings-audio-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("settings-audio-body")}
          </Typography>
        </Box>

        <FormControl disabled={!canManage || saving}>
          <RadioGroup
            value={policy}
            onChange={(event) => {
              setPolicy(event.target.value as AudioRetentionPolicy);
              setStatus(null);
            }}
            aria-label={t("settings-audio-retention-label")}
            className="gap-2"
          >
            {POLICIES.map((value) => (
              <FormControlLabel
                key={value}
                value={value}
                control={<Radio />}
                className="border-divider m-0! items-start rounded-2xl border px-3 py-2"
                label={
                  <Box className="py-1">
                    <Typography variant="subtitle2">{t(`settings-audio-${value}`)}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t(`settings-audio-${value}-help`)}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </FormControl>

        {status === "error" && <Alert severity="error">{t("settings-audio-save-error")}</Alert>}
        {status === "saved" && <Alert severity="success">{t("settings-audio-saved")}</Alert>}

        {canManage && (
          <Box>
            <Button variant="contained" onClick={() => void save()} disabled={saving || policy === org.audioRetention}>
              {t("settings-save")}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
