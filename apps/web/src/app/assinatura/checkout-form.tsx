"use client";

import { startCheckout } from "../(dashboard)/settings/billing/actions";
import PaymentChoice, { type PaymentChoiceValue } from "./payment-choice";
import Link from "next/link";
import { useState } from "react";

import { Alert, Box, Button, Divider, Grid, TextField, Typography } from "@mui/material";

import { CepField, CpfCnpjField, PhoneField } from "@/components/product/fields";
import { COOKIE_KEYS } from "@/constants";
import NiCheck from "@/icons/nexture/ni-check";
import { readCouponCookie } from "@/lib/offer-link";
import { createClient } from "@flyee/auth/client";
import { formatCep, formatCpfCnpj, formatPhoneBr, isValidCpfCnpj, onlyDigits } from "@flyee/fields";

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
  minutesLabel,
  guaranteeDays,
  canManage,
  switchingFrom,
  profile,
  priceCents,
  planPeriod,
  pixAvailable,
}: {
  orgId: string;
  planId: string;
  planName: string;
  priceLabel: string;
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

  const submit = async () => {
    setError(null);
    if (!isValidCpfCnpj(document)) {
      setError("document_invalid");
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
    const coupon = readCouponCookie(COOKIE_KEYS.offerCoupon);
    const result = await startCheckout({
      orgId,
      planId,
      idempotencyKey: operationKey,
      couponCode: coupon || null,
      paymentMethod: payment.method,
      installments: payment.installments,
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
    window.location.assign(result.url);
  };

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
              label="Telefone (opcional)"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              invalidMessage="Confira o telefone."
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
      {error === "suspended" && <Alert severity="error">Esta conta está suspensa. Fale com a gente.</Alert>}
      {error === "pix_unavailable" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          O PIX não está disponível para esta assinatura agora. Selecionamos o cartão para você — é só continuar.
        </Alert>
      )}
      {error &&
        ![
          "document_invalid",
          "profile_save_failed",
          "billing_profile_required",
          "offer_closed",
          "coupon_invalid",
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
