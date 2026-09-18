-- ============================================================
-- 0104_admin_accounts_overview: the one question the tenants console could
-- not answer — "who are these accounts, and which of them needs me today?"
--
-- The console listed organization name, plan name and member count. Nothing
-- said WHO the account is (the workspace name is free text the professional
-- typed at sign-up: several read just "Consultório"), when the money renews,
-- how much trial is left, or whether anyone has used the product this month.
-- Answering that per row from the browser would be a dozen queries per
-- account; this RPC answers it once, in the database, for every workspace.
--
-- Three things it deliberately does NOT reinvent:
--
--   * minutes, trial and entitlement come from `org_audio_allowance` (0024 /
--     0055 / 0069), the single answer to "may this workspace record, and how
--     much is left". A second calculation here would drift from the one the
--     product enforces;
--   * the live subscription is the same one the rest of the platform reads —
--     latest row in trialing/active/past_due (`subscriptions_org_live_unique`
--     allows only one);
--   * the owner is the workspace's first owner membership, with the identity
--     that actually names the account: display name, e-mail, professional
--     title and registration.
--
-- `renewalDays` is NULL on purpose for a comped plan: 0067 leaves its period
-- bounds NULL so the allowance keeps metering, so there is no renewal date to
-- show — the console says "comped" instead of inventing one.
--
-- Flags are computed here, not in the browser, so the summary tiles and the
-- rows can never disagree. `idle` needs real activity that stopped (a
-- brand-new account that never did anything is `never_activated`, which is a
-- different conversation).
-- ============================================================

create or replace function public.admin_accounts_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  -- The nightly operator watch (apps/web/src/lib/admin-jobs.ts) runs as the
  -- service role: same data, no session. Everything else still needs the
  -- platform role, and the service key never reaches a browser.
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  with live_sub as (
    select distinct on (s.org_id)
      s.org_id,
      s.id as subscription_id,
      s.status::text as status,
      coalesce(s.admin_suspended, false) as admin_suspended,
      s.provider::text as provider,
      nullif(btrim(coalesce(s.provider_subscription_id, '')), '') as provider_subscription_id,
      s.current_period_end,
      coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
      s.past_due_since,
      p.slug as plan_slug,
      p.name as plan_name,
      coalesce(p.is_free, false) as is_free,
      p.price_cents,
      p.period::text as plan_period,
      p.currency
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status in ('trialing', 'active', 'past_due')
    order by s.org_id, s.created_at desc
  ),
  -- Who the account IS. The owner membership first; any member if the owner
  -- ever left, so a workspace never shows up anonymous.
  org_owner as (
    select distinct on (m.org_id)
      m.org_id,
      m.user_id,
      pr.display_name,
      pr.professional_title,
      pr.professional_registration,
      u.email,
      nullif(btrim(coalesce(u.phone, '')), '') as phone,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    join auth.users u on u.id = m.user_id
    order by m.org_id, (m.role = 'owner') desc, m.created_at
  ),
  account as (
    select
      o.id as org_id,
      o.name,
      o.slug,
      o.created_at,
      o.timezone,
      nullif(btrim(coalesce(o.billing_phone, '')), '') as billing_phone,
      o.billing_cpf_cnpj is not null as has_billing_id,
      ow.user_id as owner_id,
      ow.display_name as owner_name,
      ow.email as owner_email,
      ow.phone as owner_phone,
      ow.professional_title,
      ow.professional_registration,
      ow.last_sign_in_at,
      ow.email_confirmed_at,
      ow.banned_until,
      (select count(*) from public.memberships m where m.org_id = o.id) as member_count,
      ls.subscription_id,
      ls.status,
      ls.admin_suspended,
      ls.provider,
      ls.provider_subscription_id,
      ls.current_period_end,
      ls.cancel_at_period_end,
      ls.past_due_since,
      ls.plan_slug,
      ls.plan_name,
      ls.is_free,
      ls.price_cents,
      ls.plan_period,
      ls.currency,
      t.started_at as trial_started_at,
      t.ends_at as trial_ends_at,
      t.minutes_limit as trial_minutes,
      t.started_via,
      sa.origem,
      sa.onda,
      sa.utm_source,
      sa.utm_campaign,
      sa.landing_path,
      u.*,
      public.org_audio_allowance(o.id) as allowance
    from public.organizations o
    left join org_owner ow on ow.org_id = o.id
    left join live_sub ls on ls.org_id = o.id
    left join public.pro_trials t on t.org_id = o.id
    left join public.signup_attribution sa on sa.org_id = o.id
    cross join lateral (
      select
        (select count(*) from public.patients pt where pt.org_id = o.id) as patients,
        (select count(*) from public.consultations c where c.org_id = o.id) as consultations,
        (select count(*) from public.consultations c where c.org_id = o.id and c.status = 'finalized') as finalized,
        (
          select count(*) from public.consultations c
          where c.org_id = o.id and c.status = 'finalized' and c.finalized_at >= now() - interval '30 days'
        ) as finalized_30d,
        (
          select count(*) from public.consultations c
          where c.org_id = o.id and c.status = 'scheduled' and c.scheduled_for >= now()
        ) as upcoming,
        (
          select count(*) from public.recordings r
          where r.org_id = o.id and r.created_at >= now() - interval '30 days'
        ) as recordings_30d,
        (
          select count(*) from public.library_usage l
          where l.org_id = o.id and l.created_at >= now() - interval '30 days'
        ) as library_30d,
        (
          select coalesce(sum(au.seconds), 0) from public.audio_usage au
          where au.org_id = o.id and au.created_at >= now() - interval '30 days'
        ) as audio_seconds_30d,
        (select count(*) from public.documents d where d.org_id = o.id and d.status = 'issued') as documents,
        -- "Last time this practice did anything", across the surfaces that
        -- mean work: the chart, the recorder, the library, the registry.
        greatest(
          (select max(c.updated_at) from public.consultations c where c.org_id = o.id),
          (select max(r.created_at) from public.recordings r where r.org_id = o.id),
          (select max(l.created_at) from public.library_usage l where l.org_id = o.id),
          (select max(pt.updated_at) from public.patients pt where pt.org_id = o.id),
          (select max(d.issued_at) from public.documents d where d.org_id = o.id)
        ) as last_activity_at
    ) u
  ),
  shaped as (
    select
      a.*,
      case
        when a.current_period_end is not null
        then ceil(extract(epoch from (a.current_period_end - now())) / 86400.0)::int
      end as renewal_days,
      case
        when a.trial_ends_at is not null
        then ceil(extract(epoch from (a.trial_ends_at - now())) / 86400.0)::int
      end as trial_days_left,
      case
        when a.last_activity_at is not null
        then floor(extract(epoch from (now() - a.last_activity_at)) / 86400.0)::int
      end as idle_days,
      -- Monthly-normalized price, so a yearly plan never reads as one month's
      -- revenue. Whether it is REAL revenue is a separate question, answered
      -- by provider_subscription_id: a comped plan (0067) is capability given
      -- away, and counting it as MRR would be lying to ourselves.
      case
        when coalesce(a.is_free, true) or a.price_cents is null then 0
        when a.plan_period = 'yearly' then round(a.price_cents / 12.0)::int
        when a.plan_period = 'weekly' then round(a.price_cents * 52 / 12.0)::int
        else a.price_cents
      end as monthly_cents
    from account a
  ),
  flagged as (
    select
      s.*,
      array_remove(array[
        case when s.owner_id is null then 'no_owner' end,
        case when s.admin_suspended then 'suspended' end,
        case when s.status = 'past_due' then 'past_due' end,
        case when s.cancel_at_period_end then 'canceling' end,
        case when coalesce((s.allowance ->> 'trial_active')::boolean, false) then 'trial_active' end,
        case
          when coalesce((s.allowance ->> 'trial_active')::boolean, false) and s.trial_days_left <= 3
          then 'trial_ending'
        end,
        case
          when s.trial_ends_at is not null and s.trial_ends_at <= now() and coalesce(s.is_free, true)
          then 'trial_over'
        end,
        case
          when not coalesce(s.is_free, true) and s.status in ('active', 'trialing') and not s.admin_suspended
          then 'paid'
        end,
        case when s.finalized = 0 then 'never_activated' end,
        case when s.idle_days >= 14 then 'idle' end,
        case when s.owner_id is not null and s.email_confirmed_at is null then 'unconfirmed' end,
        case when s.banned_until > now() then 'banned' end,
        case when s.created_at >= now() - interval '7 days' then 'new' end
      ], null) as flags
    from shaped s
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'accounts', count(*),
      'paid', count(*) filter (where 'paid' = any(flags)),
      'trialActive', count(*) filter (where 'trial_active' = any(flags)),
      'trialEnding', count(*) filter (where 'trial_ending' = any(flags)),
      'trialOver', count(*) filter (where 'trial_over' = any(flags)),
      'pastDue', count(*) filter (where 'past_due' = any(flags)),
      'suspended', count(*) filter (where 'suspended' = any(flags)),
      'canceling', count(*) filter (where 'canceling' = any(flags)),
      'idle', count(*) filter (where 'idle' = any(flags)),
      'neverActivated', count(*) filter (where 'never_activated' = any(flags)),
      'unconfirmed', count(*) filter (where 'unconfirmed' = any(flags)),
      'new', count(*) filter (where 'new' = any(flags)),
      -- What the providers are actually charging every month…
      'mrrCents', coalesce(sum(monthly_cents) filter (
        where provider_subscription_id is not null and status = 'active' and not cancel_at_period_end
      ), 0),
      -- …what is about to stop (unpaid, or cancelling at the period end)…
      'atRiskMrrCents', coalesce(sum(monthly_cents) filter (
        where provider_subscription_id is not null and (status = 'past_due' or cancel_at_period_end)
      ), 0),
      -- …and what the console is giving away for free.
      'compedMrrCents', coalesce(sum(monthly_cents) filter (
        where provider_subscription_id is null and not coalesce(is_free, true)
      ), 0),
      'currency', coalesce(min(currency) filter (where not coalesce(is_free, true)), 'BRL')
    ),
    'accounts', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orgId', org_id,
          'name', name,
          'slug', slug,
          'createdAt', created_at,
          'timezone', timezone,
          'memberCount', member_count,
          'owner', case when owner_id is null then null else jsonb_build_object(
            'userId', owner_id,
            'name', owner_name,
            'email', owner_email,
            'phone', coalesce(owner_phone, billing_phone),
            'title', professional_title,
            'registration', professional_registration,
            'lastSignInAt', last_sign_in_at,
            'confirmed', email_confirmed_at is not null,
            'bannedUntil', banned_until
          ) end,
          'billing', jsonb_build_object(
            -- The kill-switch acts on this row; without it the console would
            -- have to look the subscription up again to suspend access.
            'subscriptionId', subscription_id,
            'planSlug', plan_slug,
            'planName', plan_name,
            'isFree', is_free,
            'priceCents', price_cents,
            'monthlyCents', monthly_cents,
            'currency', currency,
            'status', status,
            'suspended', admin_suspended,
            'provider', provider,
            -- A plan the console gave away (0067) has no provider behind it.
            'providerManaged', provider_subscription_id is not null,
            'currentPeriodEnd', current_period_end,
            'renewalDays', renewal_days,
            'cancelAtPeriodEnd', cancel_at_period_end,
            'pastDueSince', past_due_since,
            'graceEndsAt', allowance -> 'grace_ends_at',
            'hasBillingId', has_billing_id
          ),
          'trial', case when trial_ends_at is null then null else jsonb_build_object(
            'startedAt', trial_started_at,
            'endsAt', trial_ends_at,
            'daysLeft', greatest(trial_days_left, 0),
            'minutesLimit', trial_minutes,
            'startedVia', started_via,
            'active', coalesce((allowance ->> 'trial_active')::boolean, false)
          ) end,
          'minutes', jsonb_build_object(
            'source', allowance ->> 'source',
            'limit', (allowance ->> 'minutes_limit')::int,
            'used', (allowance ->> 'minutes_used')::int,
            'remaining', (allowance ->> 'minutes_remaining')::int,
            'percent', (allowance ->> 'percent')::int,
            'canStart', (allowance ->> 'can_start')::boolean,
            'clinicalReasoning', (allowance ->> 'clinical_reasoning')::boolean,
            'reason', allowance ->> 'reason'
          ),
          'usage', jsonb_build_object(
            'patients', patients,
            'consultations', consultations,
            'finalized', finalized,
            'finalized30d', finalized_30d,
            'upcoming', upcoming,
            'recordings30d', recordings_30d,
            'libraryMessages30d', library_30d,
            'minutes30d', ceil(audio_seconds_30d / 60.0)::int,
            'documents', documents,
            'lastActivityAt', last_activity_at,
            'idleDays', idle_days
          ),
          'attribution', case when origem is null and utm_source is null and landing_path is null then null
            else jsonb_build_object(
              'origem', origem,
              'onda', onda,
              'utmSource', utm_source,
              'utmCampaign', utm_campaign,
              'landingPath', landing_path
            ) end,
          'flags', to_jsonb(flags)
        )
        order by created_at desc
      ),
      '[]'::jsonb
    )
  )
  into result
  from flagged;

  return result;
end;
$$;

comment on function public.admin_accounts_overview() is
  'Superadmin account management view: identity, plan, renewal, trial, minutes, usage and origin for every workspace, plus the totals behind the summary tiles.';

revoke all on function public.admin_accounts_overview() from public, anon;
-- `is_superadmin()` inside the function is the real gate; the grant only lets
-- an authenticated session reach it.
grant execute on function public.admin_accounts_overview() to authenticated;
