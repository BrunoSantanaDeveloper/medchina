"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Input,
  Paper,
  Typography,
} from "@mui/material";

import Logo from "@/components/logo/logo";
import { SESSION_STORAGE_KEYS } from "@/constants";
import NiEmailOpen from "@/icons/nexture/ni-email-open";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { sanitizeInternalNext } from "@flyee/clinical";

/** Matches the provider's own resend throttle, so the button cannot promise
 *  what the server will refuse. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Where sign-up lands when the Supabase project requires email confirmation:
 * the account exists but has no session yet. Honest by design — it states what
 * happened and what to do, and never pretends to verify anything itself (the
 * template's version offered fake "send code to ****8714" options).
 *
 * It also RESENDS. Without that, an e-mail lost to spam or a mistyped address
 * ended the sign-up here with no action available but "back to sign-in" — the
 * first place a sale dies when the professional is creating her account during
 * a call (docs/FUNIL.md D13).
 */
export default function Page() {
  const t = useTranslations("auth");
  const requestedNext = useSearchParams().get("next");
  const next = requestedNext ? sanitizeInternalNext(requestedNext) : null;
  /**
   * She is mid-purchase, and this screen is the only place in the flow that
   * asks her to leave the page. Saying what the link leads back to is the
   * difference between "confirm your e-mail" (a chore) and "confirm and finish
   * subscribing" (the thing she came to do).
   */
  const buyingPlan = Boolean(next?.startsWith("/settings/billing"));

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [cooldown, setCooldown] = useState(0);

  // Handed over by the sign-up screen so she does not retype what she just
  // typed; still editable, because a typo in the address is exactly the case
  // that brings someone here.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEYS.signupEmail);
      if (stored) setEmail(stored);
    } catch {
      // Storage refused (private mode): the field simply starts empty.
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!email.trim() || cooldown > 0 || !isSupabaseConfigured) return;
    setStatus("sending");
    try {
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      if (next) callback.searchParams.set("next", next);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: callback.toString() },
      });
      setStatus(error ? "error" : "sent");
      // Started even on failure: the usual cause IS the provider's own throttle,
      // and letting her hammer the button only earns a longer block.
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setStatus("error");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden h-9 w-auto" />
          </Box>

          <Box className="flex flex-col gap-10">
            <Box className="flex flex-col">
              <Typography variant="h1" component="h1" className="mb-2">
                {t("get-verification-title")}
              </Typography>
            </Box>

            <Alert severity="info" icon={<NiEmailOpen />} className="neutral bg-background-paper/60!">
              <AlertTitle variant="subtitle2">{t("get-verification-title")}</AlertTitle>
              {t("get-verification-body")}
              {buyingPlan && (
                <Typography variant="body2" className="text-text-primary mt-2">
                  {t("get-verification-offer-note")}
                </Typography>
              )}
            </Alert>

            <Box className="flex flex-col gap-3">
              <FormControl>
                <FormLabel htmlFor="resend-email">{t("get-verification-email-label")}</FormLabel>
                <Input
                  id="resend-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (status !== "idle") setStatus("idle");
                  }}
                />
              </FormControl>
              <Button
                variant="outlined"
                onClick={() => void resend()}
                disabled={!email.trim() || cooldown > 0 || status === "sending"}
              >
                {cooldown > 0 ? t("get-verification-resend-wait", { seconds: cooldown }) : t("get-verification-resend")}
              </Button>
              {/* Deliberately does not confirm whether an account exists for the
                  address — this screen is reachable by anyone. */}
              {status === "sent" && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("get-verification-resend-sent")}
                </Typography>
              )}
              {status === "error" && (
                <Typography variant="body2" className="text-error">
                  {t("get-verification-resend-error")}
                </Typography>
              )}
            </Box>

            <Divider className="text-text-secondary my-0 text-sm"></Divider>
            <Typography variant="body1" className="text-text-secondary">
              <Link
                href={`/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                className="link-primary link-underline-hover"
              >
                {t("get-verification-back")}
              </Link>
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
