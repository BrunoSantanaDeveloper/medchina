"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Divider, Paper, Typography } from "@mui/material";

import VerificationCodeInput from "@/components/auth/verification-code-input";
import Logo from "@/components/logo/logo";
import { DEFAULTS } from "@/config";
import { useHydrated } from "@/hooks/use-hydrated";
import { resolvePostAuthDestination } from "@/lib/onboarding";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { sanitizeInternalNext } from "@flyee/clinical";
import { BRAND } from "@flyee/content";

/** Step-up screen: verifies the TOTP code and raises the session to AAL2. */
export default function TwoFactor() {
  const router = useRouter();
  const t = useTranslations("auth");
  const hydrated = useHydrated();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) {
        router.replace("/auth/sign-in");
        return;
      }
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.find((factor) => factor.status === "verified");
      if (!totp) {
        // No verified factor — nothing to challenge.
        router.replace(DEFAULTS.appRoot);
        return;
      }
      setFactorId(totp.id);
    };
    load();
  }, [router]);

  const verify = async () => {
    if (!factorId || code.trim().length < 6 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) {
        setError(t("two-factor-failed"));
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) {
        setError(t("two-factor-failed"));
        return;
      }
      const requestedNext = new URLSearchParams(window.location.search).get("next");
      const next = requestedNext ? sanitizeInternalNext(requestedNext) : null;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const destination = user ? await resolvePostAuthDestination(supabase, user.id) : DEFAULTS.appRoot;
      router.push(next ?? destination);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        {/* Rhythm from the template's auth/set-verification: the logo sits on
            its own with mb-14, then one gap-10 column holds title, form and
            the closing block. */}
        <Box className="flex flex-col px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </Box>

          <Box className="flex flex-col gap-10">
            <Box className="flex flex-col">
              <Typography variant="h1" component="h1" className="mb-2">
                {t("two-factor-title")}
              </Typography>
              <Typography variant="body1" className="text-text-primary">
                {t("two-factor-subtitle")}
              </Typography>
            </Box>

            <Box
              component="form"
              method="post"
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                verify();
              }}
            >
              {/* Six boxes, the template's shape: a six-digit code should look
                  like six digits. One wide text field gave no sense of how
                  many were left and no place for a paste to land. */}
              <VerificationCodeInput
                label={t("two-factor-code")}
                value={code}
                onChange={setCode}
                onComplete={() => void verify()}
                autoFocus
                disabled={busy}
              />

              {error && (
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {error}
                </Alert>
              )}

              <Button type="submit" variant="contained" disabled={!factorId || code.length < 6 || busy || !hydrated}>
                {busy ? t("two-factor-verifying") : t("two-factor-verify")}
              </Button>
              <Button color="grey" variant="text" onClick={signOut}>
                {t("sent-back")}
              </Button>
            </Box>

            <Divider className="text-text-secondary my-0 text-sm" />

            {/* The template closes with "did not get the code? resend". There
                is nothing to resend here: the code comes from an authenticator
                app on her phone, not from us. Same shape, true content — the
                real recovery is a person, because only a platform operator can
                clear a second factor (admin/organizations). */}
            <Box className="flex flex-col">
              <Typography variant="h6" component="h6">
                {t("two-factor-lost-title")}
              </Typography>
              <Typography variant="body1" className="text-text-secondary">
                {t("two-factor-lost-body")}{" "}
                <Link href={BRAND.support.helpCenter} className="link-primary link-underline-hover">
                  {t("two-factor-lost-link")}
                </Link>
                .
              </Typography>
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
