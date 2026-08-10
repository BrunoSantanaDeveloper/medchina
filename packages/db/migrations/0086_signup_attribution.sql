-- ---------------------------------------------------------------------------
-- 0086 — Where a workspace came from
-- ---------------------------------------------------------------------------
-- The commercial plan (docs/FUNIL.md) runs the base in waves: the former paying
-- users, then the ~480 old signups, then a partner's audience, then schools.
-- Comparing those cohorts is the whole point of running them separately — and
-- it is the one measurement that CANNOT be reconstructed afterwards. A cohort
-- is not backfillable: if the first wave goes out before this exists, the
-- answer to "which channel produced paying customers" is lost permanently.
--
-- Deliberately NOT folded into `meta_attribution` (0051), which looks adjacent:
-- that table holds ad-click identifiers (_fbp/_fbc) captured AT CHECKOUT to
-- match a Purchase back to a Meta ad, is rewritten on every checkout, and is
-- meaningless outside the Conversions API. This one holds the campaign
-- dimension captured at the FIRST touch, is written once per workspace and
-- never updated, and exists to be grouped by in a report. Same shape, opposite
-- lifecycle — merging them would mean one row that is both overwritten and
-- immutable.
--
-- First touch, never overwritten: the campaign that BROUGHT her earned the
-- signup. Later visits — a bookmark, a search result, a second campaign — must
-- not rewrite history, which is why the app inserts with ON CONFLICT DO NOTHING
-- and nothing here ever updates.

create table if not exists public.signup_attribution (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  -- Written by the operator into campaign links (?origem=whatsapp&onda=1).
  origem text,
  onda text,
  -- Standard ad parameters, for paid traffic later.
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  -- Where the click came from and which landing page it hit: which page
  -- converts is a different question from which campaign sent her.
  referrer text,
  landing_path text,
  captured_at timestamptz not null default now(),
  -- Query parameters are attacker-controlled. The app bounds them too; this is
  -- the fence that survives a future caller that forgets.
  constraint signup_attribution_lengths check (
    coalesce(length(origem), 0) <= 64
    and coalesce(length(onda), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
    and coalesce(length(utm_term), 0) <= 64
    and coalesce(length(referrer), 0) <= 255
    and coalesce(length(landing_path), 0) <= 255
  )
);

comment on table public.signup_attribution is
  'First-touch campaign attribution for a workspace, captured from the link that brought the professional to the site and written once at signup. Never updated: a later campaign does not get credit for a signup an earlier one produced. Grouped by in the funnel reports (docs/FUNIL.md T5.2/T5.3).';

-- Reporting reads it by wave and by channel, always over a date range.
create index if not exists signup_attribution_onda_idx
  on public.signup_attribution (onda, captured_at desc);
create index if not exists signup_attribution_origem_idx
  on public.signup_attribution (origem, captured_at desc);

alter table public.signup_attribution enable row level security;

-- Written by the service role only (the capture runs server-side, after the
-- account exists). Read by the platform operator, who is the only person the
-- data is for — the professional's own screens never show it.
create policy "signup_attribution_select_superadmin" on public.signup_attribution
  for select to authenticated
  using (public.is_superadmin());

revoke all on table public.signup_attribution from anon;
