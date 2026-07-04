# @flyee/billing

Per-organization billing behind a single `PaymentProvider` interface, with **Stripe** and **Asaas** implementations.

## Model (see packages/db/migrations/0001_billing.sql)

- **Plans** — `recurring` (weekly/monthly/yearly) or `credits` (credit grants per cycle, or one-time non-expiring purchase when `period` is null). Free plan (`is_free`) is assigned automatically to every new organization. Prices, periods, trial days and `limits` (feature caps) are superadmin-managed rows — no code changes.
- **Modules** — add-ons (`recurring` or `one_time`) offered as order bumps at checkout and attachable later.
- **Coupons** — percent or fixed discounts, validated via the `validate_coupon()` RPC (no table enumeration).
- **Subscriptions** — one live row per org; `admin_suspended` is the superadmin kill-switch, independent of the provider lifecycle. Feature gating reads `org_entitlements(org_id)`.
- **Credits** — append-only ledger (`credit_transactions`); balance via `org_credit_balance()`, consumption via `consume_credits()`.
- **Invoices** — local mirror of provider charges for the customer billing page.

## Providers

| Concern | Stripe | Asaas |
|---|---|---|
| Checkout | Hosted Checkout Session (dynamic `price_data`, no dashboard setup) | Subscription/payment + hosted `invoiceUrl` (Pix/boleto/card) |
| Trial | `trial_period_days` | first `nextDueDate` pushed forward |
| Coupons | mirrored Stripe coupon (`duration: forever`) | discount applied to the charge value |
| One-time order bumps | extra line item on the first invoice | separate immediate payment (API limitation) |
| Webhook auth | signature (`STRIPE_WEBHOOK_SECRET`) | shared token (`ASAAS_WEBHOOK_TOKEN`) |

Both parse webhooks into normalized `BillingEvent`s; persistence lives in the app webhook route (`/api/webhooks/[provider]`), which runs with the service-role client.

## Env vars (apps/web/.env)

```
STRIPE_SECRET_KEY=      STRIPE_WEBHOOK_SECRET=
ASAAS_API_KEY=          ASAAS_WEBHOOK_TOKEN=
ASAAS_BASE_URL=         # default: sandbox; set https://api.asaas.com/v3 in production
```

A provider with no key simply doesn't appear as a checkout option (`configuredProviders()`).

## Planned: `pix-direct` provider (no gateway fees)

Third provider on the roadmap: direct Pix settlement through the account bank's **API Pix** (Banco Central's standardized spec — offered free/near-free for PJ accounts by Inter, Banco do Brasil, Sicoob, Sicredi). Dynamic charges (`cob`) with `txid` for exact reconciliation, signed (mTLS) webhooks, and Pix Automático for recurrence where supported — otherwise invoice-style renewal (new charge per cycle; subscription sits `past_due` until paid, which this schema already models). Implement as another `PaymentProvider` once a PJ account with API credentials exists. Do NOT build billing on bank e-mail notifications — unverifiable sender, no txid, heuristic reconciliation.

## Superadmin

`profiles.is_superadmin` gates catalog management and subscription suspension. Bootstrap the first superadmin manually:

```sql
update public.profiles set is_superadmin = true where id = '<user uuid>';
```
