-- ============================================================
-- 0051_meta_attribution
-- Server-side ad attribution signals captured at checkout and reused to enrich
-- the browserless Purchase Conversions API event fired from the billing webhook.
--
-- The Meta Pixel runs ONLY on the marketing site (health-data rule: no in-app
-- tracker). It sets _fbp/_fbc cookies on the same origin, so when the
-- professional starts checkout the APP request can still read them server-side
-- — no Pixel loads on the clinical app. We stash those signals here, keyed by
-- org, and the webhook (which has no browser context) reads them back so the
-- Purchase event matches the ad click. Service-role only; never client-exposed.
-- Cascades on org deletion (LGPD erasure).
-- ============================================================

create table if not exists public.meta_attribution (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  fbp text,
  fbc text,
  email text,
  client_ip text,
  client_user_agent text,
  updated_at timestamptz not null default now()
);

alter table public.meta_attribution enable row level security;
-- No policies: the service role bypasses RLS; authenticated/anon get nothing.
revoke all on table public.meta_attribution from public;
