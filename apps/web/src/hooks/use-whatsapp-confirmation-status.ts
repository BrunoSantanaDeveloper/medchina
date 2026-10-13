"use client";

import { useEffect, useState } from "react";

import { readSignupWhatsApp, type SignupWhatsAppStatus } from "@/app/auth/sign-up/actions";

/** How often a confirmation screen asks whether her message arrived. */
const POLL_MS = 3000;

/**
 * The state of one WhatsApp confirmation (migration 0122), watched for as long
 * as it is undecided: every few seconds, and at once when she comes back to
 * this tab from WhatsApp. A failed read is not an answer — the screen keeps
 * waiting rather than telling her the code expired because the network blinked.
 *
 * Pass `null` while there is no code on screen. A new token starts a new watch.
 */
export function useWhatsAppConfirmationStatus(token: string | null): SignupWhatsAppStatus {
  const [state, setState] = useState<{ token: string | null; status: SignupWhatsAppStatus }>({
    token,
    status: { status: "pending" },
  });
  // A different code is a different question: the old answer does not carry over.
  const status: SignupWhatsAppStatus = state.token === token ? state.status : { status: "pending" };
  const waiting = token !== null && (status.status === "pending" || status.status === "retry");

  useEffect(() => {
    if (!token || !waiting) return;
    let cancelled = false;
    const check = async () => {
      const result = await readSignupWhatsApp(token).catch((): SignupWhatsAppStatus => ({ status: "retry" }));
      if (!cancelled && result.status !== "retry") setState({ token, status: result });
    };
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [token, waiting]);

  return status;
}
