-- ============================================================
-- 0054_billing_grace_period: a failed renewal is not a cancellation.
--
-- Until now `past_due` cut every AI capability in the same instant the
-- provider reported a failed charge — mid-appointment, with a patient in the
-- room. A recused card is an accident, not a decision to stop paying, and the
-- product's own rule (PRD §5.8: never interrupt care for a commercial reason)
-- argues for a window to fix it.
--
-- So `past_due` now keeps the plan usable for a CONFIGURABLE number of days
-- counted from the moment the failure was recorded. After the window the
-- previous behaviour returns: new AI work stops, the record stays readable.
--
-- The second half of this migration is about honesty in the UI. The allowance
-- used to report only flags (`can_start`, `trial_available`, `suspended`), and
-- every screen had to INFER why it was blocked — which is how "your minutes
-- ran out" ended up being shown to someone whose card had failed. Both
-- allowance functions now name the reason, so each cause can get the action
-- that actually resolves it.
-- ============================================================

-- ---------- When the failure started ----------
-- The provider lifecycle already gives us `status`; what was missing is WHEN
-- it turned, which is what a grace window has to count from.

alter table public.subscriptions
  add column if not exists past_due_since timestamptz;

-- Rows already sitting in past_due start their window now rather than being
-- retroactively expired by a migration they never saw coming.
update public.subscriptions
set past_due_since = coalesce(updated_at, now())
where status = 'past_due' and past_due_since is null;

-- ---------- The window, as configurable data ----------
-- 7 days covers a provider's card-retry cycle plus a long weekend. Zero
-- restores the old immediate cut, which is what makes this reversible without
-- a deploy.

insert into public.platform_settings (key, value)
values ('dunning', '{"grace_days": 7}'::jsonb)
on conflict (key) do nothing;

-- ---------- One answer about the window, shared by every gate ----------
-- Audio minutes, library messages and generic entitlements must agree about
-- whether a workspace is inside its grace window; three copies of this
-- arithmetic would eventually disagree about the same subscription.

create or replace function public.billing_past_due_grace_ends(subscription_row public.subscriptions)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when subscription_row.id is null or subscription_row.status <> 'past_due' then null
    else coalesce(subscription_row.past_due_since, subscription_row.updated_at, now())
      + make_interval(days => greatest(
          coalesce((select (value ->> 'grace_days')::int from public.platform_settings where key = 'dunning'), 0),
          0
        ))
  end;
$$;

-- Only the SECURITY DEFINER gates below call this; there is no reason for a
-- client to ask about the window except through them.
revoke all on function public.billing_past_due_grace_ends(public.subscriptions) from public, anon, authenticated;

-- ---------- Audio minutes ----------

create or replace function public.org_audio_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  trial public.pro_trials%rowtype;
  window_start timestamptz;
  window_end timestamptz;
  limit_minutes integer := 0;
  used_seconds bigint := 0;
  used_minutes integer := 0;
  percent integer := 0;
  src text := 'none';
  plan_minutes integer := 0;
  trial_available boolean := false;
  can_start boolean := false;
  can_reason boolean := false;
  suspended boolean := false;
  grace_ends timestamptz;
  in_grace boolean := false;
  plan_usable boolean := false;
  reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if sub.id is not null then
    select * into plan from public.plans where id = sub.plan_id;
    plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
  end if;

  suspended := coalesce(sub.admin_suspended, false);
  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  -- A recused card keeps working until the window closes; the superadmin
  -- kill-switch never does.
  plan_usable := sub.id is not null
    and not suspended
    and (sub.status in ('trialing', 'active') or in_grace);

  select * into trial from public.pro_trials where org_id = target_org;

  -- A paid audio plan DECIDES, whether or not it is currently usable: an org
  -- that bought minutes must never silently fall back to an old trial pool.
  if plan_minutes > 0 then
    if plan_usable then
      src := 'plan';
      limit_minutes := plan_minutes;
      window_start := coalesce(sub.current_period_start, date_trunc('month', now()));
      window_end := coalesce(sub.current_period_end, window_start + interval '1 month');
    end if;
  elsif trial.org_id is not null and not suspended then
    -- Suspension is absolute: it must not be survivable on leftover trial days
    -- any more than it is on paid minutes.
    src := 'trial';
    limit_minutes := trial.minutes_limit;
    window_start := trial.started_at;
    window_end := trial.ends_at;
  end if;

  trial_available := trial.org_id is null and plan_minutes = 0 and not suspended;

  if src <> 'none' then
    select coalesce(sum(seconds), 0) into used_seconds
    from public.audio_usage
    where org_id = target_org
      and created_at >= window_start
      and (window_end is null or created_at < window_end);
  end if;

  -- Round the TOTAL up once, never each recording.
  used_minutes := ceil(used_seconds / 60.0);

  if limit_minutes > 0 then
    percent := least(floor(used_minutes * 100.0 / limit_minutes)::int, 999);
    can_start := used_minutes < limit_minutes;
  end if;

  if src = 'trial' and now() >= trial.ends_at then
    can_start := false;
  end if;

  if src = 'trial' then
    can_reason := can_start;
  elsif src = 'plan' then
    can_reason := can_start and coalesce((plan.limits ->> 'clinical_reasoning')::int, 0) > 0;
  end if;

  -- Why this workspace is (or is not) allowed to start AI work. Ordered by
  -- what the professional would have to do about it, most decisive first: a
  -- suspension and a failed payment are not solved by buying anything, so they
  -- must never be reported as an exhausted allowance.
  if suspended then
    reason := 'suspended';
  elsif sub.status = 'past_due' and not in_grace then
    reason := 'past_due_blocked';
  elsif can_start then
    reason := case when in_grace then 'past_due_grace' else 'ok' end;
  elsif trial_available then
    reason := 'trial_not_started';
  elsif src = 'trial' then
    reason := 'trial_over';
  elsif src = 'plan' then
    reason := 'cycle_exhausted';
  else
    reason := 'no_plan';
  end if;

  return jsonb_build_object(
    'source', src,
    'plan_slug', plan.slug,
    'plan_name', plan.name,
    'suspended', suspended,
    'minutes_limit', limit_minutes,
    'minutes_used', used_minutes,
    'minutes_remaining', greatest(limit_minutes - used_minutes, 0),
    'percent', percent,
    'window_start', window_start,
    'window_end', window_end,
    'trial_active', src = 'trial' and can_start,
    'trial_ends_at', trial.ends_at,
    'trial_available', trial_available,
    'can_start', can_start,
    'clinical_reasoning', can_reason,
    -- Named cause, so no screen has to guess it from the flags above.
    'reason', reason,
    'past_due', sub.status = 'past_due',
    'grace_ends_at', case when in_grace then grace_ends else null end
  );
end;
$$;

grant execute on function public.org_audio_allowance(uuid) to authenticated;

-- ---------- Library messages ----------
-- The other metered currency answers to the same window: a failed card should
-- not silently take the study assistant away either.

create or replace function public.org_message_allowance(target_org uuid, target_assistant text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  helper public.assistants%rowtype;
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  quota_key text;
  limit_messages integer;
  used_messages integer := 0;
  window_start timestamptz := date_trunc('month', now());
  suspended boolean := false;
  grace_ends timestamptz;
  in_grace boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into helper from public.assistants where slug = target_assistant and is_active;
  if helper.id is null then
    raise exception 'assistant not found';
  end if;

  quota_key := helper.config ->> 'quota_limit_key';
  if quota_key is null then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  suspended := coalesce(sub.admin_suspended, false);
  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  if sub.id is null then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'no_plan');
  end if;
  if suspended then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'suspended');
  end if;
  if sub.status not in ('trialing', 'active') and not in_grace then
    return jsonb_build_object(
      'allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'past_due_blocked'
    );
  end if;

  select * into plan from public.plans where id = sub.plan_id;
  limit_messages := (plan.limits ->> quota_key)::int;
  if limit_messages is null then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  -- Calendar month on purpose: "N mensagens neste mês" must read the same for
  -- the professional regardless of her billing anchor day.
  select count(*) into used_messages
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where c.org_id = target_org
    and c.assistant_id = helper.id
    and m.role = 'user'
    and m.created_at >= window_start;

  return jsonb_build_object(
    'allowed', used_messages < limit_messages,
    'unlimited', false,
    'used', used_messages,
    'limit', limit_messages,
    'window_start', window_start,
    'reason', case when used_messages < limit_messages then 'ok' else 'quota_exhausted' end
  );
end;
$$;

grant execute on function public.org_message_allowance(uuid, text) to authenticated;

-- ---------- Generic entitlements ----------
-- `org_entitlements` gates everything that is not metered. Leaving it out of
-- the window would mean two functions disagreeing about the same workspace on
-- the same day.

create or replace function public.org_entitlements(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  merged jsonb;
  grace_ends timestamptz;
  in_grace boolean := false;
begin
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('active', false, 'reason', 'no_subscription');
  end if;

  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  select p.limits into merged from public.plans p where p.id = sub.plan_id;

  select coalesce(merged || jsonb_object_agg_merged.limits, merged) into merged
  from (
    select public.jsonb_merge_agg(m.limits) as limits
    from public.subscription_modules sm
    join public.modules m on m.id = sm.module_id
    where sm.subscription_id = sub.id and sm.status = 'active'
  ) as jsonb_object_agg_merged
  where jsonb_object_agg_merged.limits is not null;

  return jsonb_build_object(
    'active', (not sub.admin_suspended) and (sub.status in ('trialing', 'active') or in_grace),
    'suspended', sub.admin_suspended,
    'status', sub.status,
    'past_due_grace', in_grace,
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'plan_id', sub.plan_id,
    'limits', coalesce(merged, '{}'::jsonb),
    'credit_balance', public.org_credit_balance(target_org)
  );
end;
$$;

-- ---------- Telemetry allowlist ----------
-- `track_product_event` sanitizes property VALUES, not just keys: a value
-- outside the list is silently dropped. The commercial prompts now distinguish
-- a failed payment from an exhausted allowance (and, from 0055, an à-la-carte
-- minute pack), so both values have to be admissible or the funnel data would
-- record the click without ever saying what it was for.
--
-- Both are added here, in one rewrite, rather than copying this whole function
-- again in the next migration for a single string.

create or replace function public.track_product_event(target_event text, target_properties jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  safe_properties jsonb;
  intent_value text;
  origin_value text;
  state_value text;
  mode_value text;
  platform_value text;
  reason_value text;
  duration_value text;
  viewport_value text;
  has_patient_value text;
  feature_value text;
begin
  if auth.uid() is null then return; end if;
  if target_event is null or target_event not in (
    'journey.track_selected', 'journey.track_reentered',
    'appointment.started', 'appointment.completed', 'appointment.abandoned',
    'patient.created_inline', 'appointment.conflict',
    'recording.started', 'recording.interrupted', 'recording.recovered',
    'recording.upload_completed', 'recording.processing_completed', 'recording.failed',
    'consultation.finalized', 'document.issued',
    'library.message_sent', 'library.quota_hit', 'case_review.started',
    'acervo.document_opened', 'citation.opened', 'briefing.opened', 'protocol.saved',
    'upgrade.prompt_viewed', 'upgrade.prompt_clicked', 'billing.contact_clicked'
  ) then
    return;
  end if;

  select org_id into target_org
  from public.memberships
  where user_id = auth.uid()
  order by created_at
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended('product-events:' || auth.uid()::text, 0));

  if (select count(*) from public.product_events
      where actor_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    return;
  end if;

  target_properties := coalesce(target_properties, '{}'::jsonb);
  if jsonb_typeof(target_properties) <> 'object' then
    target_properties := '{}'::jsonb;
  end if;

  intent_value := case when target_properties ->> 'intent' in
    ('activation', 'schedule', 'manual', 'ai', 'review', 'demo')
    then target_properties ->> 'intent' end;
  origin_value := case when target_properties ->> 'origin' in
    (
      'agenda', 'schedule', 'getting_started', 'home', 'patient',
      'consultation', 'command_palette', 'onboarding', 'mobile',
      'menu', 'usage', 'billing'
    )
    then target_properties ->> 'origin' end;
  state_value := case when target_properties ->> 'state' in
    ('paused', 'recording', 'local', 'uploading', 'uploaded', 'processing', 'ready', 'failed', 'blocked', 'recovered')
    then target_properties ->> 'state' end;
  mode_value := case when target_properties ->> 'mode' in ('ai', 'audio_only')
    then target_properties ->> 'mode' end;
  platform_value := case when target_properties ->> 'platform' in ('web', 'mobile')
    then target_properties ->> 'platform' end;
  reason_value := case when target_properties ->> 'reason_code' in (
    'audio_consent_required', 'ai_consent_required', 'allowance_unavailable',
    'recording_pending', 'checksum_mismatch', 'not_authorized',
    'invalid_consultation_transition', 'recording_not_uploaded',
    'recording_too_long', 'recording_too_large', 'network_unavailable',
    'provider_unavailable', 'processing_failed', 'audio_file_missing',
    'metadata_corrupt'
  ) then target_properties ->> 'reason_code' end;
  duration_value := case when target_properties ->> 'duration_bucket' in
    ('under_5m', '5_15m', '15_30m', '30_60m', '60_120m')
    then target_properties ->> 'duration_bucket' end;
  viewport_value := case when target_properties ->> 'viewport' in
    ('320', '375', '768', '1440', 'small', 'medium', 'large')
    then target_properties ->> 'viewport' end;
  has_patient_value := case when target_properties ->> 'has_patient' in ('true', 'false')
    then target_properties ->> 'has_patient' end;
  feature_value := case when target_properties ->> 'feature' in
    ('plans', 'audio', 'clinical_reasoning', 'payment', 'audio_pack')
    then target_properties ->> 'feature' end;

  if target_event in ('upgrade.prompt_viewed', 'upgrade.prompt_clicked', 'billing.contact_clicked') then
    safe_properties := jsonb_strip_nulls(jsonb_build_object(
      'origin', origin_value,
      'feature', feature_value
    ));
  else
    safe_properties := jsonb_strip_nulls(jsonb_build_object(
      'intent', intent_value,
      'origin', origin_value,
      'state', state_value,
      'mode', mode_value,
      'platform', platform_value,
      'reason_code', reason_value,
      'duration_bucket', duration_value,
      'viewport', viewport_value,
      'has_patient', has_patient_value
    ));
  end if;

  insert into public.product_events (org_id, actor_id, event_name, properties)
  values (target_org, auth.uid(), target_event, safe_properties);
end;
$$;

revoke all on function public.track_product_event(text, jsonb) from public;
grant execute on function public.track_product_event(text, jsonb) to authenticated;
