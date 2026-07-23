"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

export type OrgLite = { id: string; name: string; role: string };

export interface SubscriptionInfo {
  id: string;
  status: string;
  adminSuspended: boolean;
  planId: string;
  planName: string;
  planKind: string;
  isFree: boolean;
  period: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationRequestedAt: string | null;
  modules: { id: string; name: string }[];
}

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: "recurring" | "credits";
  period: "weekly" | "monthly" | "yearly" | null;
  priceCents: number;
  currency: string;
  creditAmount: number | null;
  trialDays: number;
  isFree: boolean;
  audioMinutes: number;
  limits: Record<string, unknown>;
}

export interface ModuleRow {
  id: string;
  name: string;
  description: string | null;
  kind: "recurring" | "one_time";
  priceCents: number;
}

export interface InvoiceRow {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  description: string | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CreditRow {
  id: string;
  amount: number;
  kind: string;
  description: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface BillingDetails {
  subscription: SubscriptionInfo | null;
  plans: PlanRow[];
  modules: ModuleRow[];
  invoices: InvoiceRow[];
  creditBalance: number;
  credits: CreditRow[];
}

const EMPTY_DETAILS: BillingDetails = {
  subscription: null,
  plans: [],
  modules: [],
  invoices: [],
  creditBalance: 0,
  credits: [],
};

const remoteData = <T>(state: RemoteState<T, "load_failed">): T | undefined =>
  state.status === "success"
    ? state.data
    : state.status === "loading" || state.status === "error"
      ? state.previous
      : undefined;

export function useBilling() {
  const [orgsState, setOrgsState] = useState<RemoteState<OrgLite[], "load_failed">>(() => remoteLoading());
  const [detailsState, setDetailsState] = useState<RemoteState<BillingDetails, "load_failed">>(() => remoteEmpty());
  const orgsRef = useRef<OrgLite[] | undefined>(undefined);
  const detailsRef = useRef<BillingDetails | undefined>(undefined);
  const orgRequestRef = useRef(0);
  const detailsRequestRef = useRef(0);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  const refreshOrgs = useCallback(async (preservePrevious = true) => {
    const requestId = ++orgRequestRef.current;
    if (!preservePrevious) orgsRef.current = undefined;
    const previous = preservePrevious ? orgsRef.current : undefined;
    setOrgsState(remoteLoading(previous));
    if (!isSupabaseConfigured) {
      orgsRef.current = undefined;
      setCurrentOrgId(null);
      setOrgsState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (requestId !== orgRequestRef.current) return;
    if (userError || !user) {
      setOrgsState(remoteError("load_failed", previous));
      return;
    }
    const { data, error: membershipsError } = await supabase
      .from("memberships")
      .select("role, organizations(id, name)")
      .eq("user_id", user.id)
      .order("created_at");
    if (requestId !== orgRequestRef.current) return;
    if (membershipsError) {
      setOrgsState(remoteError("load_failed", previous));
      return;
    }
    const list: OrgLite[] = (data ?? [])
      .filter((row) => row.organizations)
      .map((row) => {
        const org = row.organizations as unknown as { id: string; name: string };
        return { id: org.id, name: org.name, role: row.role };
      });
    orgsRef.current = list.length === 0 ? undefined : list;
    setCurrentOrgId((current) => (current && list.some((org) => org.id === current) ? current : (list[0]?.id ?? null)));
    setOrgsState(list.length === 0 ? remoteEmpty() : remoteSuccess(list));
  }, []);

  const refreshDetails = useCallback(
    async (preservePrevious = true) => {
      const requestId = ++detailsRequestRef.current;
      if (!preservePrevious) detailsRef.current = undefined;
      const previous = preservePrevious ? detailsRef.current : undefined;
      if (!isSupabaseConfigured || !currentOrgId) {
        detailsRef.current = undefined;
        setDetailsState(remoteEmpty());
        return;
      }
      setDetailsState(remoteLoading(previous));
      const supabase = createClient();

      const [subResult, plansResult, modulesResult, invoicesResult, balanceResult, creditsResult] = await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "id, status, admin_suspended, plan_id, period, current_period_end, trial_ends_at, cancel_at_period_end, cancellation_requested_at, plans(name, kind, is_free), subscription_modules(module_id, status, modules(name))",
          )
          .eq("org_id", currentOrgId)
          .in("status", ["trialing", "active", "past_due"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("plans").select("*").eq("is_active", true).order("sort"),
        supabase.from("modules").select("*").eq("is_active", true).order("sort"),
        supabase
          .from("invoices")
          .select("*")
          .eq("org_id", currentOrgId)
          .order("created_at", { ascending: false })
          .limit(24),
        supabase.rpc("org_credit_balance", { target_org: currentOrgId }),
        supabase
          .from("credit_transactions")
          .select("*")
          .eq("org_id", currentOrgId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (requestId !== detailsRequestRef.current) return;
      if (
        subResult.error ||
        plansResult.error ||
        modulesResult.error ||
        invoicesResult.error ||
        balanceResult.error ||
        creditsResult.error
      ) {
        setDetailsState(remoteError("load_failed", previous));
        return;
      }

      const sub = subResult.data;
      let subscription: SubscriptionInfo | null = null;
      if (sub) {
        const plan = sub.plans as unknown as { name: string; kind: string; is_free: boolean } | null;
        const subModules =
          (sub.subscription_modules as unknown as
            | { module_id: string; status: string; modules: { name: string } | null }[]
            | null) ?? [];
        subscription = {
          id: sub.id,
          status: sub.status,
          adminSuspended: sub.admin_suspended,
          planId: sub.plan_id,
          planName: plan?.name ?? "Unknown plan",
          planKind: plan?.kind ?? "recurring",
          isFree: plan?.is_free ?? false,
          period: sub.period,
          currentPeriodEnd: sub.current_period_end,
          trialEndsAt: sub.trial_ends_at,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          cancellationRequestedAt: sub.cancellation_requested_at,
          modules: subModules
            .filter((m) => m.status === "active")
            .map((m) => ({ id: m.module_id, name: m.modules?.name ?? "Module" })),
        };
      }

      const details: BillingDetails = {
        subscription,
        plans: (plansResult.data ?? []).map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          kind: p.kind,
          period: p.period,
          priceCents: p.price_cents,
          currency: p.currency,
          creditAmount: p.credit_amount,
          trialDays: p.trial_days,
          isFree: p.is_free,
          audioMinutes: Number((p.limits as { audio_minutes?: number } | null)?.audio_minutes ?? 0),
          limits: (p.limits as Record<string, unknown> | null) ?? {},
        })),
        modules: (modulesResult.data ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          kind: m.kind,
          priceCents: m.price_cents,
        })),
        invoices: (invoicesResult.data ?? []).map((invoice) => ({
          id: invoice.id,
          amountCents: invoice.amount_cents,
          currency: invoice.currency,
          status: invoice.status,
          description: invoice.description,
          invoiceUrl: invoice.invoice_url,
          paidAt: invoice.paid_at,
          createdAt: invoice.created_at,
        })),
        creditBalance: balanceResult.data ?? 0,
        credits: (creditsResult.data ?? []).map((tx) => ({
          id: tx.id,
          amount: tx.amount,
          kind: tx.kind,
          description: tx.description,
          expiresAt: tx.expires_at,
          createdAt: tx.created_at,
        })),
      };
      detailsRef.current = details;
      setDetailsState(remoteSuccess(details));
    },
    [currentOrgId],
  );

  useEffect(() => {
    void refreshOrgs(false);
  }, [refreshOrgs]);

  useEffect(() => {
    void refreshDetails(false);
  }, [refreshDetails]);

  const orgs = remoteData(orgsState) ?? [];
  const details = remoteData(detailsState) ?? EMPTY_DETAILS;
  const currentOrg = orgs.find((org) => org.id === currentOrgId) ?? null;
  const canManage = currentOrg ? ["owner", "admin"].includes(currentOrg.role) : false;
  const orgsLoading = orgsState.status === "loading" && !orgsState.previous;
  const detailsLoading = detailsState.status === "loading" && !detailsState.previous;

  return {
    configured: isSupabaseConfigured,
    loading: orgsLoading || (Boolean(currentOrgId) && detailsLoading),
    orgsState,
    detailsState,
    loadFailed: orgsState.status === "error" || detailsState.status === "error",
    refreshing:
      (orgsState.status === "loading" && Boolean(orgsState.previous)) ||
      (detailsState.status === "loading" && Boolean(detailsState.previous)),
    orgs,
    currentOrg,
    canManage,
    setCurrentOrgId,
    subscription: details.subscription,
    plans: details.plans,
    modules: details.modules,
    invoices: details.invoices,
    creditBalance: details.creditBalance,
    credits: details.credits,
    retry: async () => {
      if (orgsState.status === "error") await refreshOrgs(true);
      else await refreshDetails(true);
    },
    refreshDetails,
  };
}

export const formatMoney = (cents: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
