"use client";

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

import { createClient } from "@gogo/auth/client";

type Factor = { id: string; friendly_name?: string | null; status: string };

type Enrollment = { factorId: string; qrCode: string; secret: string };

/** Supabase returns the QR as an SVG string or a data URL depending on version. */
const qrSrc = (qr: string) => (qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`);

export default function TwoFactorCard() {
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
      friendlyName: "Authenticator app",
    });
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Enrollment failed.");
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
        setError(challengeError?.message ?? "Could not start the challenge.");
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) {
        setError(verifyError.message);
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
    if (unenrollError) setError(unenrollError.message);
    refresh();
  };

  const verifiedFactors = factors.filter((factor) => factor.status === "verified");

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h5" component="h2" className="card-title">
            Two-factor authentication
          </Typography>
          <Typography variant="body1" className="text-text-secondary">
            With a verified authenticator app, every sign-in requires a 6-digit code in addition to your password.
          </Typography>

          {verifiedFactors.map((factor) => (
            <Box key={factor.id} className="flex flex-row items-center gap-2">
              <Chip label="active" size="small" color="success" variant="outlined" />
              <Typography variant="body1" className="flex-1">
                {factor.friendly_name ?? "Authenticator app"}
              </Typography>
              <Button size="small" color="error" variant="text" onClick={() => removeFactor(factor.id)}>
                Remove
              </Button>
            </Box>
          ))}

          {!enrollment && verifiedFactors.length === 0 && (
            <Box>
              <Button variant="outlined" color="grey" onClick={startEnrollment}>
                Enable two-factor authentication
              </Button>
            </Box>
          )}

          {enrollment && (
            <Box className="flex flex-col gap-3">
              <Typography variant="body1">
                Scan the QR code with your authenticator app (or enter the secret manually), then confirm with a code.
              </Typography>
              <img src={qrSrc(enrollment.qrCode)} alt="TOTP QR code" className="h-44 w-44 self-start" />
              <Typography variant="body2" className="text-text-secondary break-all">
                Secret: {enrollment.secret}
              </Typography>
              <Box className="flex flex-row items-end gap-2">
                <FormControl className="outlined mb-0" variant="standard" size="small">
                  <FormLabel component="label">Code</FormLabel>
                  <Input
                    value={code}
                    inputProps={{ inputMode: "numeric", maxLength: 6 }}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  />
                </FormControl>
                <Button variant="contained" onClick={confirmEnrollment} disabled={code.length < 6 || busy}>
                  {busy ? "Verifying..." : "Confirm"}
                </Button>
                <Button
                  color="grey"
                  variant="text"
                  onClick={() => {
                    removeFactor(enrollment.factorId);
                    setEnrollment(null);
                  }}
                >
                  Cancel
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
