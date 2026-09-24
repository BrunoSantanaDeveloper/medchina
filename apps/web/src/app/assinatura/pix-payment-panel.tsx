"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, TextField, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import { createClient } from "@flyee/auth/client";
import type { PixCharge } from "@flyee/billing/types";

/** How often the page asks whether the provider confirmed. */
const POLL_MS = 4_000;
/**
 * When the page stops asking on its own. A PIX normally confirms in seconds;
 * past this point the webhook is late, not the payment, and polling a page she
 * may have forgotten open for an hour only costs queries. The plan is released
 * by the webhook either way — this only decides when the SCREEN stops waiting.
 */
const POLL_CAP_MS = 20 * 60_000;
/**
 * The "já paguei" button appears once the page has checked this many times and
 * the charge is still open. Deliberately a count of real checks, not a clock:
 * a countdown on the button would be a timer we invented, and the honest
 * moment to offer "I paid" is after we have looked and not yet seen it.
 */
const CHECKS_BEFORE_PAID_BUTTON = 2;

const EXPIRY_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

type Phase = "waiting" | "confirmed" | "timeout";

/**
 * The PIX charge, on OUR page instead of the provider's.
 *
 * What changed for her: she used to leave for a page with another company's
 * look to scan a code; now the code is here, and this page watches for the
 * confirmation itself. What did NOT change: the charge, the QR and the hosted
 * invoice are exactly the provider's — the hosted page stays one tap away as
 * the fallback, because it shows the same code and always works.
 *
 * Confirmation is the WEBHOOK's job, never this page's: the subscription row is
 * `incomplete` until the provider says otherwise, and that is all this reads.
 * Leaving early loses nothing — the plan is released wherever she is, and the
 * guided onboarding's badge says "confirmando pagamento" until it is.
 */
export default function PixPaymentPanel({
  pix,
  orgId,
  planId,
  planName,
  priceLabel,
}: {
  pix: PixCharge;
  orgId: string;
  planId: string;
  planName: string;
  priceLabel: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [checks, setChecks] = useState(0);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (phase !== "waiting") return;
    let active = true;
    const poll = async () => {
      // A hidden tab keeps its place but stops spending queries.
      if (!active || document.visibilityState === "hidden") return;
      if (Date.now() - startedAt.current > POLL_CAP_MS) {
        setPhase("timeout");
        return;
      }
      try {
        const { data } = await createClient()
          .from("subscriptions")
          .select("status")
          .eq("org_id", orgId)
          .eq("plan_id", planId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!active) return;
        if (data?.status === "active" || data?.status === "trialing") {
          setPhase("confirmed");
          return;
        }
        setChecks((count) => count + 1);
      } catch {
        // A transient failure must not turn a payable code into an error.
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [orgId, phase, planId]);

  // Confirmed while she was looking: say so, then take her on.
  useEffect(() => {
    if (phase !== "confirmed") return;
    const timer = window.setTimeout(() => router.push("/onboarding?pagamento=confirmado"), 2_500);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix.copyPaste);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3_000);
    } catch {
      // Clipboard can be refused (permissions, insecure context). The field
      // below is selectable, so the code is never out of reach.
    }
  };

  if (phase === "confirmed") {
    return (
      <Box className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
        <span className="bg-accent-1/15 text-accent-1 flex h-14 w-14 items-center justify-center rounded-2xl">
          <NiCheck size="large" />
        </span>
        <Typography variant="h1" component="h1" className="mb-0">
          Pagamento confirmado
        </Typography>
        <Typography variant="body1" className="text-text-secondary">
          O {planName} já está liberado. Levando você para a configuração…
        </Typography>
      </Box>
    );
  }

  const expires = pix.expiresAt ? EXPIRY_FORMAT.format(new Date(pix.expiresAt)) : null;

  return (
    <Box className="flex flex-col gap-5">
      <Box className="flex flex-col gap-1">
        <Typography variant="h1" component="h1" className="mb-0">
          Pague com PIX
        </Typography>
        <Typography variant="body1" className="text-text-secondary">
          {planName} · {priceLabel}. Abra o app do seu banco e escaneie o código, ou copie e cole.
        </Typography>
      </Box>

      <Box className="border-grey-200 flex flex-col items-center gap-4 rounded-2xl border p-5 sm:flex-row sm:items-start">
        <Box
          component="img"
          src={`data:image/png;base64,${pix.qrCodeBase64}`}
          alt={`QR Code do PIX para pagar ${planName}`}
          className="h-52 w-52 flex-none rounded-xl bg-white p-2"
        />
        <Box className="flex w-full min-w-0 flex-col gap-3">
          <TextField
            label="PIX copia e cola"
            value={pix.copyPaste}
            fullWidth
            size="small"
            multiline
            maxRows={3}
            slotProps={{ htmlInput: { readOnly: true, "aria-readonly": true } }}
            onFocus={(event) => event.target.select()}
          />
          <Button variant="outlined" onClick={() => void copy()} className="self-start">
            {copied ? "Código copiado" : "Copiar código"}
          </Button>
          {/* The provider's own instant, not a countdown we invented. */}
          {expires && (
            <Typography variant="body2" className="text-text-secondary">
              Este código vale até {expires} (horário de Brasília).
            </Typography>
          )}
        </Box>
      </Box>

      {/* On PIX, "renews by itself" would be false: each cycle is a NEW code she
          pays by hand. Saying so here is what stops a subscription from lapsing
          on someone who never knew there was something to pay. */}
      <Alert severity="info" className="neutral bg-background-paper/60!">
        No PIX, cada renovação chega como um código novo, por e-mail, para você pagar. Se preferir renovação automática,
        o cartão faz isso sozinho.
      </Alert>

      {phase === "timeout" ? (
        <Alert severity="info">
          Ainda não recebemos a confirmação do banco. Se você já pagou, não precisa pagar de novo: o plano é liberado
          assim que a confirmação chegar, e avisamos por e-mail.
        </Alert>
      ) : (
        <Box className="flex items-center gap-3" role="status" aria-live="polite">
          <CircularProgress size={18} aria-hidden />
          <Typography variant="body2" className="text-text-secondary">
            Aguardando a confirmação do pagamento. Esta página atualiza sozinha.
          </Typography>
        </Box>
      )}

      {(checks >= CHECKS_BEFORE_PAID_BUTTON || phase === "timeout") && (
        <Box className="flex flex-col gap-2">
          <Button variant="contained" size="large" onClick={() => router.push("/onboarding?pagamento=pix")}>
            Já paguei, continuar
          </Button>
          <Typography variant="body2" className="text-text-secondary text-center">
            Você segue para a configuração. A confirmação do banco continua sendo verificada, e o plano é liberado
            sozinho assim que chegar.
          </Typography>
        </Box>
      )}

      {pix.invoiceUrl && (
        <Typography variant="body2" className="text-text-secondary text-center">
          Problemas com o código?{" "}
          <a href={pix.invoiceUrl} className="link-primary" rel="noopener noreferrer">
            Abrir a fatura na operadora
          </a>
          .
        </Typography>
      )}
    </Box>
  );
}
