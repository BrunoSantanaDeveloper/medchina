"use client";

import { startCheckout } from "../(dashboard)/settings/billing/actions";
import PaymentChoice, { type PaymentChoiceValue } from "./payment-choice";
import PixPaymentPanel from "./pix-payment-panel";
import Link from "next/link";
import { useState } from "react";

import { Alert, Box, Button, Divider, Grid, TextField, Typography } from "@mui/material";

import { CepField, CpfCnpjField, PhoneField } from "@/components/product/fields";
import { COOKIE_KEYS } from "@/constants";
import NiCheck from "@/icons/nexture/ni-check";
import type { CampaignParams } from "@/lib/campaign-params";
import { readCouponCookie } from "@/lib/offer-link";
import { createClient } from "@flyee/auth/client";
import type { PixCharge } from "@flyee/billing/types";
import { formatCep, formatCpfCnpj, formatPhoneBr, isValidCpfCnpj, isValidPhoneBr, onlyDigits } from "@flyee/fields";

type Profile = {
  document: string | null;
  postalCode: string | null;
  addressNumber: string | null;
  phone: string | null;
};

/**
 * The whole purchase, in one submit.
 *
 * The step it removes is the one that used to kill the sale. Before, she saved
 * the fiscal data, the page came back, and the LAST action of the purchase was
 * pressing a button she had already pressed once — after a detour she never
 * asked to take. Here the document and the payment are one gesture, and the
 * button says where it goes, because a "Salvar" that silently redirects to a
 * payment provider is the kind of surprise that ends in a chargeback.
 *
 * Only the document is required. CEP, number and phone improve the invoice and
 * reduce anti-fraud friction, so they are asked for and never block.
 */
export default function CheckoutForm({
  orgId,
  planId,
  planName,
  priceLabel,
  scheduleLines = null,
  minutesLabel,
  guaranteeDays,
  canManage,
  switchingFrom,
  profile,
  priceCents,
  planPeriod,
  pixAvailable,
  campaign,
}: {
  orgId: string;
  planId: string;
  planName: string;
  priceLabel: string;
  /**
   * The whole price ladder of a plan sold in phases (migration 0126), one line
   * per stretch. Null for a single price. Its presence also means the plan
   * takes no coupon: the server refuses the combination, so none is sent.
   */
  scheduleLines?: string[] | null;
  minutesLabel: string | null;
  guaranteeDays: number;
  canManage: boolean;
  switchingFrom: string | null;
  profile: Profile;
  /** Drives the instalment labels; the server re-derives the real amount. */
  priceCents: number;
  planPeriod: string | null;
  /** False while the account cannot charge Pix, so it is never offered. */
  pixAvailable: boolean;
  /** The campaign of this purchase (last touch), forwarded from the landing link. */
  campaign?: CampaignParams;
}) {
  const [document, setDocument] = useState(() => (profile.document ? formatCpfCnpj(profile.document) : ""));
  const [postalCode, setPostalCode] = useState(() => (profile.postalCode ? formatCep(profile.postalCode) : ""));
  const [addressNumber, setAddressNumber] = useState(profile.addressNumber ?? "");
  const [phone, setPhone] = useState(() => (profile.phone ? formatPhoneBr(profile.phone) : ""));
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Pre-selected: an unselected choice is one more decision standing between
  // her and the purchase, and the card is the method that renews by itself.
  const [payment, setPayment] = useState<PaymentChoiceValue>({ method: "credit_card", installments: 1 });
  // Stable across retries so a second click cannot open a second invoice for
  // the same intent; regenerated only when the attempt is abandoned.
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  // The PIX charge, once the server returns one. From then on the form is
  // gone: the purchase exists, and what is left is paying it.
  const [pix, setPix] = useState<PixCharge | null>(null);

  const submit = async () => {
    setError(null);
    if (!isValidCpfCnpj(document)) {
      setError("document_invalid");
      return;
    }
    // Required: it is how she is reached about this payment and her access —
    // on WhatsApp, which is where this audience actually answers.
    if (!isValidPhoneBr(phone)) {
      setError("phone_invalid");
      return;
    }
    setWorking(true);

    // Persist the fiscal data first: the provider refuses to create a customer
    // without it, and the failure would surface as "temporarily unavailable".
    const supabase = createClient();
    const { data, error: saveError } = await supabase.rpc("update_billing_profile", {
      target_org: orgId,
      // Digits, never the mask — the repo-wide rule for semantic fields, and
      // the format the provider expects.
      target_cpf_cnpj: onlyDigits(document),
      target_postal_code: postalCode ? onlyDigits(postalCode) : null,
      target_address_number: addressNumber.trim() || null,
      target_phone: phone ? onlyDigits(phone) : null,
    });
    if (saveError || (data as { ok?: boolean } | null)?.ok !== true) {
      setWorking(false);
      setError("profile_save_failed");
      return;
    }

    // The campaign code the middleware captured on the click, before sign-up
    // and e-mail confirmation stripped the query string.
    // A plan sold in phases takes no coupon (startCheckout refuses it), so a
    // code left in the cookie by another link is not sent at all.
    const coupon = scheduleLines ? "" : readCouponCookie(COOKIE_KEYS.offerCoupon);
    const result = await startCheckout({
      orgId,
      planId,
      idempotencyKey: operationKey,
      couponCode: coupon || null,
      paymentMethod: payment.method,
      installments: payment.installments,
      campaign: campaign ?? null,
      // This is someone's FIRST purchase: there is no billing screen worth
      // returning to, and a paid account that lands on a settings page has to
      // work out what to do next on its own. She returns to the guided trail,
      // whichever payment method she picked — including PIX, where the plan is
      // still being confirmed and the trail's badge says so.
      returnTo: "onboarding",
    });
    if (!result.url) {
      setWorking(false);
      // A fresh key for the next attempt: the failed one may have a provider
      // session attached to a state she has just changed.
      setOperationKey(crypto.randomUUID());
      // Pix refused: put her on the card, already selected, so the recovery
      // is one tap on the same button instead of a decision to make again.
      if (result.error === "pix_unavailable") setPayment({ method: "credit_card", installments: 1 });
      setError(result.error ?? "unavailable");
      return;
    }
    // PIX with a readable QR stays HERE. Everything else — card, or a QR the
    // provider did not return in time — goes to the hosted invoice, which is
    // the contract and always works.
    if (result.pix) {
      setWorking(false);
      setPix(result.pix);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.location.assign(result.url);
  };

  if (pix) {
    return <PixPaymentPanel pix={pix} orgId={orgId} planId={planId} planName={planName} priceLabel={priceLabel} />;
  }

  if (!canManage) {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        Só quem administra o consultório pode contratar um plano. Peça a quem criou a conta para concluir, ou fale com a
        gente.
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-6">
      <Box className="flex flex-col gap-1">
        <Typography variant="h1" component="h1" className="mb-0">
          Concluir assinatura
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          Falta só confirmar seus dados e escolher como pagar.
        </Typography>
      </Box>

      {switchingFrom && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          Você já assina o {switchingFrom}. Trocar de plano abre uma assinatura nova e encerra a atual na hora, sem
          crédito pelos dias já pagos.
        </Alert>
      )}

      <Box className="flex flex-col gap-3">
        <Typography variant="subtitle2" className="text-text-secondary">
          Passo 1 de 2 · seus dados
        </Typography>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <CpfCnpjField
              label="CPF ou CNPJ"
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              invalidMessage="Confira o CPF ou CNPJ."
              fullWidth
              size="small"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <PhoneField
              label="WhatsApp"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              invalidMessage="Confira o número de WhatsApp, com DDD."
              fullWidth
              size="small"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <CepField
              label="CEP (opcional)"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              invalidMessage="Confira o CEP."
              fullWidth
              size="small"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Número (opcional)"
              value={addressNumber}
              onChange={(event) => setAddressNumber(event.target.value)}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>
      </Box>

      <Divider />

      <Box className="flex flex-col gap-3">
        <Typography variant="subtitle2" className="text-text-secondary">
          Passo 2 de 2 · pagamento
        </Typography>

        <PaymentChoice
          value={payment}
          onChange={setPayment}
          pixAvailable={pixAvailable}
          // Splitting a monthly plan would sell a year of cycles as one
          // purchase; the server refuses it regardless, this only keeps the
          // form from offering what would be refused.
          installmentsAvailable={planPeriod !== null && planPeriod !== "monthly"}
          priceCents={priceCents}
          disabled={working}
        />

        <Box className="border-grey-200 flex flex-col gap-2 rounded-2xl border p-5">
          <Typography variant="h6" component="p" className="mb-0">
            {planName}
          </Typography>
          <Typography variant="h4" component="p" className="mb-0">
            {priceLabel}
          </Typography>
          {scheduleLines && scheduleLines.length > 0 && (
            <Box
              component="ul"
              className="m-0 flex list-none flex-col gap-1 p-0 text-sm"
              aria-label="Valor de cada mês"
            >
              {scheduleLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Box>
          )}
          <Box component="ul" className="text-text-secondary m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {minutesLabel && (
              <li className="flex items-center gap-1">
                <NiCheck size="small" className="text-primary" /> {minutesLabel}
              </li>
            )}
            <li className="flex items-center gap-1">
              <NiCheck size="small" className="text-primary" /> {guaranteeDays} dias de garantia
            </li>
            <li className="flex items-center gap-1">
              <NiCheck size="small" className="text-primary" /> Cancele pelo painel, sem ligação
            </li>
          </Box>
        </Box>
      </Box>

      {error === "document_invalid" && <Alert severity="error">Confira o CPF ou CNPJ antes de continuar.</Alert>}
      {error === "phone_invalid" && (
        <Alert severity="error">Informe um número de WhatsApp com DDD para continuar.</Alert>
      )}
      {error === "profile_save_failed" && (
        <Alert severity="error">Não conseguimos salvar seus dados agora. Tente de novo em instantes.</Alert>
      )}
      {error === "billing_profile_required" && (
        <Alert severity="warning">O CPF ou CNPJ é obrigatório para a fatura.</Alert>
      )}
      {error === "offer_closed" && (
        <Alert severity="info">Esta condição não está mais disponível. Fale com a gente antes de assinar.</Alert>
      )}
      {error === "coupon_invalid" && (
        <Alert severity="warning">O cupom do seu link não vale mais. Recarregue a página para seguir sem ele.</Alert>
      )}
      {error === "coupon_not_combinable" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Esta condição não se combina com cupom. Recarregue a página para seguir com o preço dela.
        </Alert>
      )}
      {error === "suspended" && <Alert severity="error">Esta conta está suspensa. Fale com a gente.</Alert>}
      {error === "pix_unavailable" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          O PIX não está disponível para esta assinatura agora. Selecionamos o cartão para você — é só continuar.
        </Alert>
      )}
      {error &&
        ![
          "document_invalid",
          "phone_invalid",
          "profile_save_failed",
          "billing_profile_required",
          "offer_closed",
          "coupon_invalid",
          "coupon_not_combinable",
          "suspended",
          "pix_unavailable",
        ].includes(error) && (
          <Alert severity="error">Não conseguimos abrir o pagamento agora. Tente de novo em instantes.</Alert>
        )}

      <Button variant="contained" size="large" onClick={() => void submit()} disabled={working}>
        {working ? "Abrindo o pagamento..." : payment.method === "pix" ? "Pagar com PIX" : "Pagar com cartão"}
      </Button>

      <Typography variant="body2" className="text-text-secondary text-center">
        Pagamento processado pela operadora. Dentro de {guaranteeDays} dias, o reembolso é integral.{" "}
        <Link href="/legal/garantia" target="_blank" rel="noopener noreferrer" className="link-primary">
          Ler os termos
        </Link>
        .
      </Typography>
    </Box>
  );
}
