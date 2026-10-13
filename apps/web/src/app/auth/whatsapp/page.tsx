"use client";

import WhatsAppConfirmation from "../sign-up/whatsapp-confirmation";
import { startAccountWhatsApp } from "./actions";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, Paper, Typography } from "@mui/material";

import { BRAND } from "@/brand";
import Logo from "@/components/logo/logo";
import { DEFAULTS } from "@/config";
import { SESSION_STORAGE_KEYS } from "@/constants";
import { useWhatsAppConfirmationStatus } from "@/hooks/use-whatsapp-confirmation-status";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { SIGNUP_CODE_SHAPE, SIGNUP_TOKEN_SHAPE } from "@/lib/signup-whatsapp-shared";
import { createClient } from "@flyee/auth/client";
import { sanitizeInternalNext } from "@flyee/clinical";

type Pending = { token: string; code: string; number: string };

/** The code she was already shown in this tab, so a reload does not mint another. */
function readStored(): Pending | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEYS.accountWhatsApp);
    const value = raw ? (JSON.parse(raw) as Partial<Pending>) : null;
    if (
      value &&
      typeof value.token === "string" &&
      SIGNUP_TOKEN_SHAPE.test(value.token) &&
      typeof value.code === "string" &&
      SIGNUP_CODE_SHAPE.test(value.code) &&
      typeof value.number === "string"
    ) {
      return { token: value.token, code: value.code, number: value.number };
    }
  } catch {
    // Storage refused or holding something else: a fresh code costs nothing.
  }
  return null;
}

function store(pending: Pending | null) {
  try {
    if (pending) sessionStorage.setItem(SESSION_STORAGE_KEYS.accountWhatsApp, JSON.stringify(pending));
    else sessionStorage.removeItem(SESSION_STORAGE_KEYS.accountWhatsApp);
  } catch {
    // Private-mode refusal only costs the reuse on reload.
  }
}

/**
 * Where an account that still owes its WhatsApp confirmation is held (migration
 * 0122) — in practice, the sign-up that came from a campaign, right after the
 * payment. That order is the point: asking between the ad and the checkout is
 * an obstacle on the one path where every extra step is a lost sale, so the
 * account is created and charged first, and the middleware brings it here the
 * moment it leaves the checkout.
 *
 * Same mechanism as the sign-up — she sends a code from her own WhatsApp and
 * the screen moves on by itself — but the code is minted for the signed-in
 * account, and confirming it is what lets her into the app. There is no form
 * behind this screen, so the only other way out is to sign out.
 */
export default function Page() {
  const router = useRouter();
  const t = useTranslations("auth");
  const next = sanitizeInternalNext(useSearchParams().get("next"), DEFAULTS.appRoot);

  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<"unavailable" | "too_many" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const status = useWhatsAppConfirmationStatus(pending?.token ?? null);
  /** One request per mount: the effect below runs twice under React's dev double-mount. */
  const requested = useRef(false);

  const proceed = useCallback(() => {
    store(null);
    setLeaving(true);
    router.replace(next);
    router.refresh();
  }, [next, router]);

  const requestCode = useCallback(async () => {
    setProblem(null);
    const started = await startAccountWhatsApp().catch(() => null);
    if (!started) {
      setProblem("unavailable");
      return;
    }
    if (started.ok) {
      const fresh = { token: started.token, code: started.code, number: started.number };
      store(fresh);
      setPending(fresh);
      return;
    }
    if (started.reason === "signed_out") {
      router.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }
    // Nothing owed (already confirmed, or the confirmation was switched off).
    if (started.reason === "not_pending") {
      proceed();
      return;
    }
    setProblem(started.reason);
  }, [next, proceed, router]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    const stored = readStored();
    if (stored) setPending(stored);
    else void requestCode();
  }, [requestCode]);

  useEffect(() => {
    if (status.status === "confirmed") proceed();
  }, [status.status, proceed]);

  const signOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    // The client keeps the session when the server call fails (a timeout, a
    // 5xx). Navigating anyway would bounce her straight back here, still signed
    // in and with no word about why — so a failed sign-out is said, and she can
    // press again.
    const failed = await createClient()
      .auth.signOut({ scope: "local" })
      .then(({ error }) => Boolean(error))
      .catch(() => true);
    if (failed) {
      setSigningOut(false);
      setSignOutFailed(true);
      return;
    }
    store(null);
    router.replace("/auth/sign-in");
    router.refresh();
  };

  const signOutButton = (
    <Box className="flex flex-col items-center gap-1">
      <Button variant="text" color="grey" disabled={signingOut} onClick={() => void signOut()}>
        {t("account-whatsapp-sign-out")}
      </Button>
      {signOutFailed && (
        <Typography variant="body2" className="text-error" role="alert">
          {t("account-whatsapp-sign-out-failed")}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </Box>

          {pending ? (
            <WhatsAppConfirmation
              code={pending.code}
              number={pending.number}
              status={status}
              intro={t("account-whatsapp-body", { brand: BRAND.name })}
              creating={leaving}
              creatingLabel={t("account-whatsapp-continuing", { brand: BRAND.name })}
              phoneTakenText={t("account-whatsapp-phone-taken", { brand: BRAND.name })}
              onNewCode={() => void requestCode()}
              footer={signOutButton}
            />
          ) : (
            <Box className="flex flex-col gap-8">
              <Box className="flex flex-col">
                <Typography variant="h1" component="h1" className="mb-2">
                  {t("signup-whatsapp-title")}
                </Typography>
                <Typography variant="body1" className="text-text-primary">
                  {t("account-whatsapp-body", { brand: BRAND.name })}
                </Typography>
              </Box>

              {problem ? (
                <Box className="flex flex-col gap-3" role="status" aria-live="polite">
                  <Alert severity="error" className="neutral bg-background-paper/60!">
                    {t(problem === "too_many" ? "signup-whatsapp-too-many" : "signup-whatsapp-unavailable")}
                  </Alert>
                  <Button
                    variant="contained"
                    onClick={() => void requestCode()}
                    startIcon={<NiRefresh size="medium" />}
                  >
                    {t("signup-whatsapp-retry")}
                  </Button>
                </Box>
              ) : (
                <Box className="flex items-center justify-center gap-2" role="status" aria-live="polite">
                  <CircularProgress size={16} aria-hidden />
                  <Typography variant="body2" className="text-text-secondary">
                    {t(leaving ? "account-whatsapp-continuing" : "account-whatsapp-loading", { brand: BRAND.name })}
                  </Typography>
                </Box>
              )}

              {!leaving && signOutButton}
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
