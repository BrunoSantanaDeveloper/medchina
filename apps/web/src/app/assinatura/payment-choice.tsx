"use client";

import { Box, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import NiMoney from "@/icons/nexture/ni-money";
import { cn } from "@/lib/utils";
import { MAX_INSTALLMENTS, type PaymentMethod } from "@flyee/billing/types";

/**
 * Where the customer picks how to pay — the step that used to happen on the
 * provider's invoice page.
 *
 * Moving it here is what removes boleto. Asaas has no way to offer a SUBSET of
 * methods on a charge (measured: a subscription takes one `billingType` or
 * `UNDEFINED`, which means everything), so the only way to not show boleto is
 * to decide the method BEFORE the charge exists.
 *
 * Three things here are about not losing the sale on the last screen:
 *
 *  - **A default is already chosen.** An unselected radio group is one more
 *    decision between her and the purchase; card is pre-selected because it is
 *    the method that renews by itself.
 *  - **The whole card is the target**, not a 20px radio. On a phone this is
 *    the difference between one tap and three.
 *  - **Installments show the instalment value, not the count.** "5x de R$ 458"
 *    is the number she is deciding about; "5x" alone makes her do the division
 *    herself, and a person doing arithmetic is a person hesitating.
 */
export type PaymentChoiceValue = { method: PaymentMethod; installments: number };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function PaymentChoice({
  value,
  onChange,
  pixAvailable,
  installmentsAvailable,
  priceCents,
  disabled,
}: {
  value: PaymentChoiceValue;
  onChange: (next: PaymentChoiceValue) => void;
  /** Pix is offered only where the account can actually charge it. */
  pixAvailable: boolean;
  /** Splitting only makes sense on a plan that is not already monthly. */
  installmentsAvailable: boolean;
  priceCents: number;
  disabled?: boolean;
}) {
  const methods: { id: PaymentMethod; title: string; hint: string; icon: React.ReactNode }[] = [
    {
      id: "credit_card",
      title: "Cartão de crédito",
      hint: installmentsAvailable ? "Acesso na hora. Pode parcelar." : "Acesso na hora, renova sozinho.",
      icon: <NiCreditCard size="medium" />,
    },
    ...(pixAvailable
      ? [
          {
            id: "pix" as const,
            title: "PIX",
            hint: "Acesso na hora, sem cartão.",
            icon: <NiMoney size="medium" />,
          },
        ]
      : []),
  ];

  const showInstallments = installmentsAvailable && value.method === "credit_card";

  return (
    <Box className="flex flex-col gap-4">
      <Box
        role="radiogroup"
        aria-label="Forma de pagamento"
        className={cn("grid gap-3", methods.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1")}
      >
        {methods.map((method) => {
          const selected = value.method === method.id;
          return (
            <Box
              key={method.id}
              component="button"
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange({ method: method.id, installments: 1 })}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-60",
                selected ? "border-primary bg-primary/5" : "border-grey-200 hover:border-grey-300 bg-transparent",
              )}
            >
              <Box className="flex w-full flex-row items-center gap-2">
                <span className={cn("flex", selected ? "text-primary" : "text-text-secondary")}>{method.icon}</span>
                <Typography variant="subtitle1" component="span" className="mb-0 font-semibold">
                  {method.title}
                </Typography>
                {selected && <NiCheck size="small" className="text-primary ml-auto" />}
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                {method.hint}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {showInstallments && (
        <Box className="flex flex-col gap-2">
          <Typography variant="body2" className="text-text-secondary">
            Em quantas vezes?
          </Typography>
          <Box role="radiogroup" aria-label="Parcelamento" className="flex flex-row flex-wrap gap-2">
            {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((count) => {
              const selected = value.installments === count;
              // Rounded DOWN per instalment so the label never promises a
              // smaller total than the provider will charge; the remainder
              // lands on the last one, which is what Asaas does too.
              const perInstallment = Math.floor(priceCents / count) / 100;
              return (
                <Box
                  key={count}
                  component="button"
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onChange({ method: "credit_card", installments: count })}
                  className={cn(
                    "cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    selected ? "border-primary bg-primary/5 text-primary" : "border-grey-200 text-text-secondary",
                  )}
                >
                  {count === 1
                    ? `À vista · ${BRL.format(priceCents / 100)}`
                    : `${count}x de ${BRL.format(perInstallment)}`}
                </Box>
              );
            })}
          </Box>
          {value.installments > 1 && (
            // Said plainly, because it is the one consequence she cannot see:
            // a split purchase is a single charge the issuer divides, so there
            // is no automatic renewal at the end of it.
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              Parcelado, a cobrança é única e não renova sozinha. Ao fim do período você decide se continua.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
