"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Typography,
} from "@mui/material";

import { createClient } from "@flyee/auth/client";

type Factor = { id: string; friendly_name?: string | null; status: string };

type Enrollment = { factorId: string; qrCode: string; secret: string };

/** Supabase returns the QR as an SVG string or a data URL depending on version. */
const qrSrc = (qr: string) => (qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`);

export default function TwoFactorCard() {
  const t = useTranslations("product");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.all ?? []) as Factor[]);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startEnrollment = async () => {
    setError(null);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: t("security-authenticator"),
    });
    if (enrollError || !data) {
      setError(t("security-action-error"));
      return;
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  };

  const confirmEnrollment = async () => {
    if (!enrollment || code.trim().length < 6 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollment.factorId,
      });
      if (challengeError || !challenge) {
        setError(t("security-action-error"));
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) {
        setError(t("security-code-error"));
        return;
      }
      setEnrollment(null);
      setCode("");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId: string) => {
    setError(null);
    const supabase = createClient();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    if (unenrollError) setError(t("security-action-error"));
    refresh();
  };

  const verifiedFactors = factors.filter((factor) => factor.status === "verified");

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h5" component="h2" className="card-title">
            {t("security-two-factor-title")}
          </Typography>
          <Typography variant="body1" className="text-text-secondary">
            {t("security-two-factor-body")}
          </Typography>

          {verifiedFactors.map((factor) => (
            <Box key={factor.id} className="flex flex-row items-center gap-2">
              <Chip label={t("security-active")} size="small" color="success" variant="outlined" />
              <Typography variant="body1" className="flex-1">
                {factor.friendly_name ?? t("security-authenticator")}
              </Typography>
              <Button size="small" color="error" variant="text" onClick={() => removeFactor(factor.id)}>
                {t("security-remove")}
              </Button>
            </Box>
          ))}

          {!enrollment && verifiedFactors.length === 0 && (
            <Box>
              <Button variant="outlined" color="grey" onClick={startEnrollment}>
                {t("security-enable")}
              </Button>
            </Box>
          )}

          {enrollment && (
            <Box className="flex flex-col gap-3">
              <Typography variant="body1">{t("security-scan")}</Typography>
              <img src={qrSrc(enrollment.qrCode)} alt={t("security-qr-alt")} className="h-44 w-44 self-start" />
              <Typography variant="body2" className="text-text-secondary break-all">
                {t("security-secret")}: {enrollment.secret}
              </Typography>
              <Box className="flex flex-row items-end gap-2">
                <FormControl className="outlined mb-0" variant="standard" size="small">
                  <FormLabel component="label">{t("security-code")}</FormLabel>
                  <Input
                    value={code}
                    inputProps={{ inputMode: "numeric", maxLength: 6 }}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  />
                </FormControl>
                <Button variant="contained" onClick={confirmEnrollment} disabled={code.length < 6 || busy}>
                  {busy ? t("security-verifying") : t("security-confirm")}
                </Button>
                <Button
                  color="grey"
                  variant="text"
                  onClick={() => {
                    removeFactor(enrollment.factorId);
                    setEnrollment(null);
                  }}
                >
                  {t("cancel")}
                </Button>
              </Box>
            </Box>
          )}

          {error && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
