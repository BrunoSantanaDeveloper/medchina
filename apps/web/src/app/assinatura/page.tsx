import CheckoutForm from "./checkout-form";
import PixPaymentPanel from "./pix-payment-panel";
import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, Box, Button, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import { getCampaignOffer } from "@/lib/campaign-offer";
import { campaignQuery, pickCampaignParams } from "@/lib/campaign-params";
import { getGuaranteeDays } from "@/lib/guarantee";
import { pendingPixCharge } from "@/lib/pending-pix";
import { createClient } from "@flyee/auth/server";
import { isPixAvailable } from "@flyee/billing";

export const metadata: Metadata = {
  title: { absolute: "Concluir assinatura · MedChina" },
  robots: { index: false, follow: false },
};

/**
 * Never rounds, still reads clean.
 *
 * This was `maximumFractionDigits: 0`, which renders a R$ 59,90 plan as
 * "R$ 60" — a price this screen states wrong, on the screen where it is about
 * to be charged. Three plans in the catalog already carry cents. Keeping the
 * minimum at 0 preserves the headline the current whole-real plans were
 * designed around ("R$ 299", not "R$ 299,00") while making a cents price
 * impossible to misstate.
 */
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const NUMBER = new Intl.NumberFormat("pt-BR");
const PERIOD_SUFFIX: Record<string, string> = { yearly: "por ano", monthly: "por mês", weekly: "por semana" };

/**
 * One screen, one job: turn a decision already made into a paid invoice.
 *
 * It exists as a TOP-LEVEL route, outside `app/(dashboard)`, and that
 * placement is the whole point. The campaign used to land on
 * `/settings/billing`, which is the settings hub: usage meters, à-la-carte
 * minute packs, invoice history, and a card announcing the free plan she is
 * currently on — surrounded by the app menu, with Pacientes, Agenda and
 * Biblioteca one click away. Someone who clicked an ad thirty seconds earlier
 * was being handed a product tour instead of a checkout, and the free-plan
 * card told her something the offer had deliberately never mentioned.
 *
 * Outside the group there is no layout to inherit, so there is no menu, no
 * header and no support widget. Nothing on this page navigates anywhere except
 * forward, plus one deliberate way out.
 *
 * Auth needs no wiring: `PUBLIC_PREFIXES` in the middleware is an allow-list,
 * so any route not listed there already requires a session, and the requested
 * path keeps its query string through the bounce. The landing sends people
 * through `/auth/sign-up?next=/assinatura?plan=…` rather than straight here,
 * because the middleware's own bounce goes to sign-IN, which is the wrong door
 * for someone who has never had an account.
 *
 * Copy is hardcoded pt-BR, like the offer pages it continues: this screen
 * exists for one campaign in one market, and routing it through six catalogs
 * would buy nothing and slow every edit.
 */
export default async function AssinaturaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawSlug = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  // The campaign of THIS purchase, forwarded by /assinar (lib/campaign-params.ts).
  const campaign = pickCampaignParams(params);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The middleware already guarantees a session here; this is the belt to its
  // braces, and it keeps the plan (and the campaign) in the destination.
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/assinatura?plan=${slug}${campaignQuery(campaign)}`)}`);
  }

  const [offer, guaranteeDays, pixAvailable] = await Promise.all([
    getCampaignOffer(),
    getGuaranteeDays(),
    isPixAvailable(),
  ]);

  // One workspace per professional in the MVP, so the first membership is THE
  // membership. `user_id` is stated rather than left to RLS: the policy would
  // filter it anyway, and a query whose correctness depends on a policy is one
  // policy edit away from being wrong.
  const { data: membership } = await supabase
    .from("memberships")
    .select(
      "org_id, role, organizations(name, billing_cpf_cnpj, billing_postal_code, billing_address_number, billing_phone)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const orgId = (membership?.org_id as string | undefined) ?? null;
  if (!orgId) {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          Falta criar seu consultório
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Sua conta existe, mas ainda não tem uma área de trabalho. Conclua o cadastro e a assinatura continua daqui.
        </Alert>
        <Button variant="contained" component={Link} href={`/auth/complete-profile?next=/assinatura?plan=${slug}`}>
          Concluir cadastro
        </Button>
      </Shell>
    );
  }

  // PostgREST types an embedded relation as an array; both shapes reach here.
  const orgRel = membership?.organizations as Record<string, unknown> | Record<string, unknown>[] | null;
  const org = (Array.isArray(orgRel) ? orgRel[0] : orgRel) ?? {};

  // `is_active`, never `is_public`: the campaign line is deliberately unlisted
  // and is reached only by the link the ads carry (migration 0085).
  const { data: planRow } = await supabase
    .from("plans")
    .select("id, slug, name, description, period, price_cents, currency, limits, is_free")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!slug || !planRow || planRow.is_free) {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          Não encontramos esta condição
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          O link pode ter expirado. Se você veio por um anúncio e queria assinar, fale com a gente — resolvemos antes
          que você assine qualquer outra coisa.
        </Alert>
        <Button variant="contained" component={Link} href="/contato?assunto=assinar">
          Falar com a gente
        </Button>
      </Shell>
    );
  }

  // The deadline the page announced is the deadline that refuses the sale, and
  // it refuses it HERE too — not only inside `startCheckout`. Letting the form
  // render and fail on submit would spend her CPF on a condition that had
  // already ended.
  const named = offer?.planSlug === planRow.slug || offer?.annualPlanSlug === planRow.slug;
  if (named && offer?.closed && offer.reason !== "not_configured") {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          {offer.reason === "expired" ? "O prazo desta condição terminou" : "Esta condição não está aberta no momento"}
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Fale com a gente antes de assinar qualquer outra coisa. Se você chegou dentro do prazo, resolvemos.
        </Alert>
        <Button variant="contained" component={Link} href="/contato?assunto=assinar">
          Falar com a gente
        </Button>
      </Shell>
    );
  }

  // Already paying for this exact plan: the checkout would open a second
  // subscription and retire the first, charging her twice for what she has.
  //
  // `incomplete` is read HERE too, and it is not a detail: it is the state a
  // PIX charge sits in until the provider's webhook confirms it. Without it,
  // reloading this page while waiting for that confirmation showed the checkout
  // again and opened a SECOND charge for a plan she had already paid for.
  //
  // Several rows are fetched and ranked in code rather than narrowed to one in
  // SQL: `maybeSingle()` errors when more than one row matches, and an errored
  // read here returns null — which would silently switch the double-charge
  // guard off for exactly the accounts that have more than one subscription row.
  const { data: subscriptionRows } = await supabase
    .from("subscriptions")
    .select("plan_id, status, plans(name, is_free)")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due", "incomplete"])
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = subscriptionRows ?? [];
  // A live subscription is what she HAS; an incomplete one is what she is
  // waiting on. They answer different questions, so they stay separate.
  const currentSub = rows.find((row) => ["trialing", "active", "past_due"].includes(row.status)) ?? null;
  const pendingSub = rows.find((row) => row.status === "incomplete") ?? null;
  const subPlanRel = currentSub?.plans as
    | { name?: string; is_free?: boolean }
    | { name?: string; is_free?: boolean }[]
    | null;
  const subPlan = (Array.isArray(subPlanRel) ? subPlanRel[0] : subPlanRel) ?? null;

  // A charge is waiting for THIS plan and she does not already hold it.
  //
  // This used to require `!currentSub` — "no live subscription at all" — and
  // was therefore dead for exactly the people it exists for: every new account
  // starts on the free plan, which IS a live subscription row. Measured: with
  // Gratuito active and a PIX pending, a reload skipped this branch, showed the
  // checkout form again, and never re-read the QR. What matters is not whether
  // she has ANY plan, but whether she already has THIS one.
  const alreadyHoldsThisPlan = Boolean(currentSub && currentSub.plan_id === planRow.id);
  if (pendingSub && pendingSub.plan_id === planRow.id && !alreadyHoldsThisPlan) {
    // The charge already exists. If it is a PIX whose code can still be read,
    // show THAT code again — the same charge, never a new one. This is what a
    // reload, a second tab or coming back from the bank app lands on.
    const waitingPix = orgId ? await pendingPixCharge(supabase, orgId, planRow.id as string) : null;
    if (waitingPix && orgId) {
      const suffix = planRow.period ? (PERIOD_SUFFIX[planRow.period] ?? "por ciclo") : "por ciclo";
      return (
        <Shell wide>
          <Box className="flex justify-center">
            <Logo classNameFull="h-11 w-auto" classNameMobile="hidden" />
          </Box>
          <PixPaymentPanel
            pix={waitingPix}
            orgId={orgId}
            planId={planRow.id as string}
            planName={planRow.name as string}
            priceLabel={`${BRL.format(Number(planRow.price_cents) / 100)} ${suffix}`}
          />
        </Shell>
      );
    }
    // A card charge in flight, or a PIX whose code the provider no longer
    // returns (paid, or expired): nothing to show but the wait itself.
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          Pagamento em confirmação
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Já registramos sua contratação do {planRow.name} e estamos aguardando a confirmação do pagamento. Isso costuma
          levar poucos minutos no Pix. Assim que o pagamento for confirmado, o plano é liberado automaticamente — você
          não precisa pagar de novo.
        </Alert>
        <Button variant="contained" component={Link} href="/onboarding">
          Continuar a configuração
        </Button>
      </Shell>
    );
  }

  if (currentSub && currentSub.plan_id === planRow.id) {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          Você já tem este plano
        </Typography>
        <Alert severity="success" className="neutral bg-background-paper/60!">
          A assinatura do {planRow.name} já está ativa nesta conta.
        </Alert>
        <Button variant="contained" component={Link} href="/inicio">
          Ir para a plataforma
        </Button>
      </Shell>
    );
  }

  const minutes = Number((planRow.limits as Record<string, number> | null)?.audio_minutes ?? 0);
  const periodSuffix = planRow.period ? (PERIOD_SUFFIX[planRow.period] ?? "por ciclo") : "por ciclo";

  return (
    <Shell wide>
      <Box className="flex justify-center">
        <Logo classNameFull="h-11 w-auto" classNameMobile="hidden" />
      </Box>

      <CheckoutForm
        orgId={orgId}
        planId={planRow.id as string}
        planName={planRow.name as string}
        priceLabel={`${BRL.format(Number(planRow.price_cents) / 100)} ${periodSuffix}`}
        minutesLabel={minutes > 0 ? `${NUMBER.format(minutes)} minutos de áudio ${periodSuffix}` : null}
        guaranteeDays={guaranteeDays}
        priceCents={Number(planRow.price_cents)}
        planPeriod={(planRow.period as string | null) ?? null}
        pixAvailable={pixAvailable}
        campaign={campaign}
        // Only the owner or an admin may start a checkout; saying so up front
        // beats letting her fill a form the server will refuse.
        canManage={membership?.role === "owner" || membership?.role === "admin"}
        // A paid plan already exists: switching starts a NEW subscription and
        // retires the current one with no credit for days already paid, at
        // either provider (docs/BILLING-AUDIT.md A1). She has to be told before
        // she pays, not after.
        switchingFrom={currentSub && !subPlan?.is_free ? (subPlan?.name ?? null) : null}
        profile={{
          document: (org.billing_cpf_cnpj as string | null) ?? null,
          postalCode: (org.billing_postal_code as string | null) ?? null,
          addressNumber: (org.billing_address_number as string | null) ?? null,
          phone: (org.billing_phone as string | null) ?? null,
        }}
      />
    </Shell>
  );
}

/** Same chrome-less card the other top-level authenticated screens use. */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper
        elevation={3}
        className={
          wide
            ? "bg-background-paper shadow-darker-xs w-2xl max-w-full rounded-4xl py-10"
            : "bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-12"
        }
      >
        <Box className="flex flex-col gap-5 px-6 sm:px-12">{children}</Box>
      </Paper>
    </Box>
  );
}
