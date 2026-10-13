-- ============================================================
-- 0122_signup_whatsapp_verification
--
-- The professional's WhatsApp, from sign-up on. Three rules, decided by the
-- owner on 2026-10-13, and each one lives where it cannot be skipped.
--
-- 1. THE NUMBER IS MANDATORY — always. Until now the sign-up never asked for
--    a phone at all (docs/FUNIL.md listed "o cadastro não coleta telefone" as
--    a data blocker), so the platform had no way to reach the people who
--    signed up. A trigger on auth.users refuses any account GoTrue writes
--    without one, whatever the form did — GoTrue's /signup is callable with
--    the public anon key, so a rule that only lives in the form is no rule.
--
-- 2. CONFIRMING the number is a SWITCH, born off. `platform_settings.signup`
--    → `whatsapp_confirmation`. While it is off the sign-up is confirmed the
--    way it always was, by e-mail, and nobody is held for anything: turning
--    it on needs a WhatsApp Cloud API number receiving messages, and a
--    migration must not close the door before that exists. The operator
--    turns it on in /admin/support, through set_signup_whatsapp_confirmation.
--
-- 3. WITH THE SWITCH ON, WHEN the confirmation happens depends on where she
--    came from:
--      * an ordinary sign-up confirms BEFORE the account exists — the screen
--        shows a code, she sends it from her own WhatsApp, and only then is
--        the account created (verified at birth);
--      * a CAMPAIGN sign-up (she is on her way to a checkout) is created at
--        once and confirms AFTER the payment. A confirmation between the ad
--        and the payment is an obstacle on the one path where every extra
--        step is a lost sale. Such an account is born PENDING: it can pay,
--        and the app holds it at the confirmation screen the moment it leaves
--        the checkout — which, after a payment, is the first thing it does.
--    The database cannot tell a campaign from any other caller, so the rule
--    it enforces is the general one: an account that presents no confirmed
--    verification is born pending. That is what makes the campaign path
--    safe to open — skipping the form's confirmation buys an account that
--    can do nothing but pay.
--
-- The confirmation itself is REVERSED (docs/PAGINA-EVENTO.md §0.2, the lead
-- starts the conversation): she sends the code TO the platform. Her message
-- proves the number is hers, needs no approved template and costs nothing,
-- and the platform's answer is a reply. The webhook
-- (/api/webhooks/whatsapp/<provider>) calls confirm_signup_verification.
--
-- WHERE THE PENDING STATE LIVES. `account_whatsapp` is the truth. A copy,
-- `whatsapp_pending`, sits in auth.users.raw_app_meta_data because the
-- middleware has to answer "may this session open this page?" on every
-- request without a query, and that field arrives with the session's user. A
-- client cannot write app metadata, and a trigger re-derives the flag from the
-- truth on every metadata write — GoTrue rewrites that column from its own
-- copy right after the insert, which would otherwise drop it.
--
-- Outside the gate: rows inserted by a direct SQL session (migrations, the
-- SQL editor, pgTAP fixtures). Those run as `postgres`, never as GoTrue's
-- role, and already hold every power the gate protects. Tests opt IN with
-- `set local medchina.signup_gate = 'enforce'` — the setting can only add
-- enforcement. Accounts that predate this migration have no row and are
-- never held.
--
-- Not versioned (enable_row_versioning) on purpose: record_versions has no
-- path to forget a phone number once the account is erased (0099 purges by
-- org_id, and these tables have none). Both cascade from auth.users instead.
-- ============================================================

-- ---------- The switch ----------

insert into public.platform_settings (key, value)
values ('signup', '{"whatsapp_confirmation": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public.signup_whatsapp_confirmation_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value -> 'whatsapp_confirmation' = 'true'::jsonb
     from public.platform_settings where key = 'signup'),
    false
  );
$$;

revoke all on function public.signup_whatsapp_confirmation_on() from public, anon, authenticated;
grant execute on function public.signup_whatsapp_confirmation_on() to service_role;

-- ---------- The account's WhatsApp ----------

create table public.account_whatsapp (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Digits, country code first. What she declared at sign-up until she
  -- confirms; from then on, the number her confirmation was sent FROM.
  phone text not null check (phone ~ '^[1-9][0-9]{7,14}$'),
  -- Decided once, when the account is created: was the confirmation switch on?
  -- An account created under the e-mail-only regime is not held later, when
  -- the operator turns the switch on.
  confirmation_required boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One WhatsApp, one account — for numbers somebody PROVED. A declared number
-- is free text: making it unique would let a typo (or a stranger) block the
-- real owner, and would tell anyone who types a number whether it has an
-- account here.
create unique index account_whatsapp_verified_phone_key
  on public.account_whatsapp (phone) where verified_at is not null;

alter table public.account_whatsapp enable row level security;

-- She reads her own; the operator reads all. Nobody writes from a session:
-- every write is a trigger or a definer function below. Revokes are by role,
-- by name (the hosted project still carries the legacy default grants).
create policy "account_whatsapp_select_own" on public.account_whatsapp
  for select to authenticated
  using (user_id = auth.uid() or public.is_superadmin());

revoke all on table public.account_whatsapp from anon;
revoke insert, update, delete, truncate on table public.account_whatsapp from authenticated;

create trigger account_whatsapp_updated_at
  before update on public.account_whatsapp
  for each row execute function public.set_updated_at();

-- ---------- A confirmation in flight ----------

create table public.signup_verifications (
  id uuid primary key default gen_random_uuid(),
  -- The e-mail the account is (or will be) created with. Binding it means a
  -- confirmed token cannot be carried to a different sign-up.
  email text not null check (email = lower(email) and length(email) between 3 and 320),
  -- NULL: confirming BEFORE the account exists (ordinary sign-up). Set: the
  -- account already exists and is pending (campaign sign-up, after payment).
  user_id uuid references auth.users (id) on delete cascade,
  -- What she sends. 32 symbols without I/O/0/1, so it survives being read
  -- aloud or retyped from a computer screen.
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  -- The browser holds the token; the database only ever sees its sha256.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  -- The language of the screen that asked, so the WhatsApp reply speaks it.
  locale text not null default 'pt-BR' check (locale in ('pt-BR', 'en', 'es', 'fr', 'de', 'zh-CN')),
  -- The sender's number as WhatsApp reported it (digits, country code first).
  phone text check (phone is null or phone ~ '^[1-9][0-9]{7,14}$'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'phone_taken')),
  verified_at timestamptz,
  -- Set by the auth.users gate for the instant between validating the token
  -- and recording the account's number; the row is deleted right after.
  consumed_by uuid,
  created_at timestamptz not null default now(),
  -- Window to SEND the code. Once confirmed, a pre-account token must be used
  -- within an hour of the confirmation (checked where it is consumed).
  expires_at timestamptz not null default now() + interval '30 minutes',
  check ((status = 'pending') = (verified_at is null)),
  check (status = 'pending' or phone is not null)
);

-- A pending code is what an inbound message is matched against.
create index signup_verifications_pending_code_idx
  on public.signup_verifications (code) where status = 'pending';
create index signup_verifications_ip_idx
  on public.signup_verifications (ip_hash, created_at desc) where ip_hash is not null;
create index signup_verifications_email_idx
  on public.signup_verifications (email, created_at desc);
create index signup_verifications_consumed_idx
  on public.signup_verifications (consumed_by) where consumed_by is not null;

-- No policy at all: only the service role (server actions, the webhook) and
-- the definer functions below touch this table.
alter table public.signup_verifications enable row level security;
revoke all on table public.signup_verifications from anon, authenticated;

-- ---------- Start: a screen asks for a code ----------

create or replace function public.start_signup_verification(
  target_email text,
  target_token_hash text,
  target_ip_hash text default null,
  target_locale text default 'pt-BR',
  target_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  email_value text := lower(btrim(coalesce(target_email, '')));
  locale_value text := case when target_locale in ('pt-BR', 'en', 'es', 'fr', 'de', 'zh-CN') then target_locale else 'pt-BR' end;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code_value text;
  random_bytes bytea;
  attempt integer := 0;
  created public.signup_verifications%rowtype;
begin
  if email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(email_value) > 320 then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$'
     or (target_ip_hash is not null and target_ip_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- An existing account only asks while it is actually waiting to confirm.
  if target_user is not null and not exists (
    select 1 from public.account_whatsapp
    where user_id = target_user and confirmation_required and verified_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;

  -- Housekeeping rides on the write path: nothing here outlives its day.
  delete from public.signup_verifications where expires_at < now() - interval '1 day';

  -- Loose windows. Whoever hits the per-network one is usually a person behind
  -- a crowded mobile network (CGNAT), so it is generous; the per-address one
  -- stops one inbox from being used to mint codes in a loop.
  if target_ip_hash is not null and (
    select count(*) from public.signup_verifications
    where ip_hash = target_ip_hash and created_at > now() - interval '1 hour'
  ) >= 30 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  if (
    select count(*) from public.signup_verifications
    where email = email_value and created_at > now() - interval '1 hour'
  ) >= 6 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  -- 32 symbols, so `byte % 32` draws each one with equal odds.
  loop
    attempt := attempt + 1;
    random_bytes := gen_random_bytes(6);
    code_value := '';
    for i in 0..5 loop
      code_value := code_value || substr(alphabet, (get_byte(random_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (
      select 1 from public.signup_verifications where code = code_value and status = 'pending'
    );
    if attempt >= 8 then
      return jsonb_build_object('ok', false, 'code', 'busy');
    end if;
  end loop;

  insert into public.signup_verifications (email, user_id, code, token_hash, ip_hash, locale)
  values (email_value, target_user, code_value, target_token_hash, target_ip_hash, locale_value)
  returning * into created;

  return jsonb_build_object('ok', true, 'code', created.code, 'expires_at', created.expires_at);
end;
$$;

revoke all on function public.start_signup_verification(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.start_signup_verification(text, text, text, text, uuid) to service_role;

-- ---------- Confirm: her WhatsApp message arrived ----------

-- `target_codes` holds every code-shaped word of the message: she may edit the
-- prefilled text, and a translated sentence can contain a six-letter word.
-- Only a word that is a live pending code matches anything.
create or replace function public.confirm_signup_verification(target_codes text[], target_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  phone_value text := btrim(coalesce(target_phone, ''));
  pending public.signup_verifications%rowtype;
begin
  if phone_value !~ '^[1-9][0-9]{7,14}$' or target_codes is null or cardinality(target_codes) = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into pending
  from public.signup_verifications
  where status = 'pending'
    and expires_at > now()
    and code = any (
      select upper(btrim(candidate)) from unnest(target_codes[1:10]) as candidate
    )
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- One WhatsApp, one account. Telling the SENDER is not an enumeration leak:
  -- only whoever controls this number can learn it from here.
  if exists (
    select 1 from public.account_whatsapp
    where phone = phone_value and verified_at is not null
      and user_id is distinct from pending.user_id
  ) then
    update public.signup_verifications
    set status = 'phone_taken', phone = phone_value, verified_at = now()
    where id = pending.id;
    return jsonb_build_object('ok', false, 'code', 'phone_taken', 'locale', pending.locale);
  end if;

  -- The account already exists (it was waiting): it is confirmed right here.
  if pending.user_id is not null then
    begin
      update public.account_whatsapp
      set phone = phone_value, verified_at = now()
      where user_id = pending.user_id;
    exception when unique_violation then
      -- Two confirmations from the same number landed together.
      update public.signup_verifications
      set status = 'phone_taken', phone = phone_value, verified_at = now()
      where id = pending.id;
      return jsonb_build_object('ok', false, 'code', 'phone_taken', 'locale', pending.locale);
    end;
    -- Touching the column is what makes the metadata trigger re-derive the flag.
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'whatsapp_pending'
    where id = pending.user_id;
  end if;

  update public.signup_verifications
  set status = 'confirmed', phone = phone_value, verified_at = now()
  where id = pending.id;

  return jsonb_build_object('ok', true, 'locale', pending.locale);
end;
$$;

revoke all on function public.confirm_signup_verification(text[], text) from public, anon, authenticated;
grant execute on function public.confirm_signup_verification(text[], text) to service_role;

-- ---------- Status: the screen polls ----------

create or replace function public.signup_verification_status(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_value public.signup_verifications%rowtype;
begin
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;

  select * into row_value from public.signup_verifications where token_hash = target_token_hash;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  if row_value.status = 'pending' and row_value.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  -- A pre-account confirmation is a token still to be spent, and it ages; one
  -- that confirmed an existing account already did its job.
  if row_value.status = 'confirmed' and row_value.user_id is null
     and row_value.verified_at <= now() - interval '1 hour' then
    return jsonb_build_object('status', 'expired');
  end if;

  -- Only the last four digits come back: the screen confirms WHICH number, and
  -- the full one never needs to travel back to a browser.
  return jsonb_strip_nulls(jsonb_build_object(
    'status', row_value.status,
    'phone_hint', case when row_value.phone is not null then right(row_value.phone, 4) end
  ));
end;
$$;

revoke all on function public.signup_verification_status(text) from public, anon, authenticated;
grant execute on function public.signup_verification_status(text) to service_role;

-- ---------- The gate on auth.users ----------

-- Is this write GoTrue's? It connects as supabase_auth_admin — the public
-- sign-up, the admin API and OAuth all arrive this way. `session_user` is the
-- login role and is not changed by SECURITY DEFINER or SET ROLE.
create or replace function public.signup_gate_applies()
returns boolean
language sql
stable
set search_path = public
as $$
  select session_user = 'supabase_auth_admin'
      or coalesce(current_setting('medchina.signup_gate', true), '') = 'enforce';
$$;

revoke all on function public.signup_gate_applies() from public, anon, authenticated;

create or replace function public.enforce_signup_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  presented text;
  declared text;
  verification public.signup_verifications%rowtype;
  verified boolean := false;
  phone_value text;
begin
  if not public.signup_gate_applies() then
    return new;
  end if;

  presented := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'whatsapp_verification', '')), '');
  declared := regexp_replace(coalesce(new.raw_user_meta_data ->> 'whatsapp', ''), '[^0-9]', '', 'g');

  -- A token that is presented must be good: quietly falling back to "pending"
  -- would turn a broken confirmation into an account she did not expect.
  if presented is not null then
    if presented !~ '^[A-Za-z0-9_-]{43}$' then
      raise exception 'whatsapp_verification_invalid' using errcode = 'P0001';
    end if;

    select * into verification
    from public.signup_verifications
    where token_hash = encode(digest(presented, 'sha256'), 'hex')
    for update;

    if not found
       or verification.user_id is not null
       or verification.status <> 'confirmed'
       or verification.verified_at <= now() - interval '1 hour'
       or verification.email <> lower(coalesce(new.email, '')) then
      raise exception 'whatsapp_verification_invalid'
        using errcode = 'P0001', hint = 'The verification is missing, unconfirmed, expired or for another e-mail.';
    end if;

    if exists (
      select 1 from public.account_whatsapp where phone = verification.phone and verified_at is not null
    ) then
      raise exception 'whatsapp_phone_taken' using errcode = 'P0001';
    end if;

    verified := true;
    phone_value := verification.phone;
    update public.signup_verifications set consumed_by = new.id where id = verification.id;
  else
    -- Rule 1: no account without a number.
    if declared !~ '^[1-9][0-9]{7,14}$' then
      raise exception 'whatsapp_number_required'
        using errcode = 'P0001', hint = 'Every account declares a WhatsApp number at sign-up (migration 0122).';
    end if;
    phone_value := declared;
  end if;

  -- The token is spent; the number is kept in the shape the platform stores.
  new.raw_user_meta_data :=
    (coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'whatsapp_verification')
    || jsonb_build_object('whatsapp', phone_value);

  -- Rule 3: with the switch on, an account that did not confirm is born pending.
  if public.signup_whatsapp_confirmation_on() and not verified then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || '{"whatsapp_pending": true}'::jsonb;
  else
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) - 'whatsapp_pending';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_signup_whatsapp() from public, anon, authenticated;

drop trigger if exists before_auth_user_created_whatsapp on auth.users;
create trigger before_auth_user_created_whatsapp
  before insert on auth.users
  for each row execute function public.enforce_signup_whatsapp();

-- The row itself can only be written once the user exists (it references it).
create or replace function public.record_signup_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  verification public.signup_verifications%rowtype;
  phone_value text;
begin
  if not public.signup_gate_applies() then
    return new;
  end if;

  select * into verification from public.signup_verifications where consumed_by = new.id;
  phone_value := coalesce(verification.phone, new.raw_user_meta_data ->> 'whatsapp');

  insert into public.account_whatsapp (user_id, phone, confirmation_required, verified_at)
  values (new.id, phone_value, public.signup_whatsapp_confirmation_on(), verification.verified_at)
  on conflict (user_id) do nothing;

  if verification.id is not null then
    delete from public.signup_verifications where id = verification.id;
  end if;

  return new;
end;
$$;

revoke all on function public.record_signup_whatsapp() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_whatsapp on auth.users;
create trigger on_auth_user_created_whatsapp
  after insert on auth.users
  for each row execute function public.record_signup_whatsapp();

-- GoTrue writes the sign-up metadata a SECOND time, right after the insert,
-- from the request's own copy: the spent token comes back in the user
-- metadata, and whatever the gate put in the app metadata is dropped. So both
-- are settled on every write: the token is removed, and the pending flag is
-- re-derived from the truth. This is also what clears the flag when she
-- confirms — confirm_signup_verification only has to touch the column.
create or replace function public.settle_auth_user_whatsapp_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ? 'whatsapp_verification' then
    new.raw_user_meta_data := new.raw_user_meta_data - 'whatsapp_verification';
  end if;

  if exists (
    select 1 from public.account_whatsapp
    where user_id = new.id and confirmation_required and verified_at is null
  ) then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || '{"whatsapp_pending": true}'::jsonb;
  elsif new.raw_app_meta_data ? 'whatsapp_pending' then
    new.raw_app_meta_data := new.raw_app_meta_data - 'whatsapp_pending';
  end if;

  return new;
end;
$$;

revoke all on function public.settle_auth_user_whatsapp_metadata() from public, anon, authenticated;

drop trigger if exists before_auth_user_metadata_whatsapp on auth.users;
create trigger before_auth_user_metadata_whatsapp
  before update of raw_user_meta_data, raw_app_meta_data on auth.users
  for each row execute function public.settle_auth_user_whatsapp_metadata();

-- ---------- The operator's switch ----------

-- Turning it OFF also releases whoever was waiting: with the confirmation off
-- there may be nothing able to receive her message, and an account held at a
-- screen that cannot let it through is the one outcome this must never leave.
create or replace function public.set_signup_whatsapp_confirmation(target_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  freed uuid[];
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_enabled is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;

  insert into public.platform_settings (key, value, updated_by)
  values ('signup', jsonb_build_object('whatsapp_confirmation', target_enabled), auth.uid())
  on conflict (key) do update
    set value = public.platform_settings.value || jsonb_build_object('whatsapp_confirmation', target_enabled),
        updated_by = auth.uid();

  if not target_enabled then
    -- Two statements, in this order: the metadata trigger re-derives the flag
    -- from account_whatsapp, so the truth has to change first.
    with released as (
      update public.account_whatsapp
      set confirmation_required = false
      where confirmation_required and verified_at is null
      returning user_id
    )
    select coalesce(array_agg(user_id), '{}') into freed from released;

    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'whatsapp_pending'
    where id = any (freed);
  end if;

  return jsonb_build_object('enabled', target_enabled, 'released', coalesce(cardinality(freed), 0));
end;
$$;

revoke all on function public.set_signup_whatsapp_confirmation(boolean) from public, anon;
-- `is_superadmin()` inside is the gate; the grant only lets a session reach it.
grant execute on function public.set_signup_whatsapp_confirmation(boolean) to authenticated;

comment on table public.account_whatsapp is
  'The WhatsApp number of each account created since migration 0122: declared at sign-up, replaced by the confirmed sender once verified.';
comment on table public.signup_verifications is
  'WhatsApp confirmations in flight (migration 0122). Pre-account ones are consumed by the auth.users gate; all are purged a day after expiry.';
comment on function public.enforce_signup_whatsapp() is
  'BEFORE INSERT gate on auth.users: GoTrue may only create an account that declares a WhatsApp number; without a confirmed verification it is born pending while the confirmation switch is on (0122).';

-- ---------- The accounts console reads the number ----------
--
-- admin_accounts_overview() (0116) showed the owner's phone from
-- auth.users.phone, a column nothing ever filled. The number is mandatory now,
-- and a number the operator cannot see is collected for nobody — least of all
-- for the campaign sign-up that stopped at the checkout, which is exactly who
-- a WhatsApp message can still bring back.
--
-- Copied verbatim from 0116 with ONE change, in `org_owner`: the phone falls
-- back to account_whatsapp. Anything that recreates this function again must
-- start from this copy, or the number silently disappears from the console.

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

  with price_book as (
    -- Read once, not per row: the rate that lets spend stand next to revenue.
    select nullif(public.ai_price_book() ->> 'usdToBrl', '')::numeric as usd_to_brl
  ),
  live_sub as (
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
      -- GoTrue's own phone column is empty for accounts that sign up by e-mail;
      -- the number every account declares since 0122 lives in account_whatsapp.
      coalesce(
        nullif(btrim(coalesce(u.phone, '')), ''),
        (select aw.phone from public.account_whatsapp aw where aw.user_id = m.user_id)
      ) as phone,
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
      spend.ai_cost_30d,
      spend.ai_calls_30d,
      spend.ai_unpriced_30d,
      spend.ai_cost_lifetime,
      spend.ai_last_at,
      spend_split.ai_by_feature_30d,
      public.org_audio_allowance(o.id) as allowance
    from public.organizations o
    left join org_owner ow on ow.org_id = o.id
    left join live_sub ls on ls.org_id = o.id
    left join public.pro_trials t on t.org_id = o.id
    left join public.signup_attribution sa on sa.org_id = o.id
    -- One pass over the ledger per account: the window the console shows, the
    -- lifetime figure the dossier needs, and how much of it we could not
    -- price (a zero next to unpriced calls is a missing price list, not a
    -- cheap account).
    cross join lateral (
      select
        coalesce(sum(sp.cost_usd_micros) filter (where sp.occurred_at >= now() - interval '30 days'), 0) as ai_cost_30d,
        count(*) filter (where sp.occurred_at >= now() - interval '30 days') as ai_calls_30d,
        count(*) filter (where sp.occurred_at >= now() - interval '30 days' and not sp.priced) as ai_unpriced_30d,
        coalesce(sum(sp.cost_usd_micros), 0) as ai_cost_lifetime,
        max(sp.occurred_at) as ai_last_at
      from public.ai_spend sp where sp.org_id = o.id
    ) spend
    -- What the money bought, so a row can be read without opening the dossier.
    cross join lateral (
      select coalesce(jsonb_object_agg(g.feature, g.cost), '{}'::jsonb) as ai_by_feature_30d
      from (
        select f.feature, coalesce(sum(f.cost_usd_micros), 0) as cost
        from public.ai_spend f
        where f.org_id = o.id and f.occurred_at >= now() - interval '30 days'
        group by f.feature
      ) g
    ) spend_split
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
      end as monthly_cents,
      -- Spend in the same unit as the revenue beside it. NULL when no rate is
      -- configured: the console then shows USD and hides the margin instead
      -- of adding two currencies together.
      case
        when pb.usd_to_brl is not null
        then round(a.ai_cost_30d * pb.usd_to_brl / 10000.0)::bigint
      end as ai_cost_30d_cents
    from account a
    cross join price_book pb
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
        case when s.created_at >= now() - interval '7 days' then 'new' end,
        -- Cost facts, never a verdict: it spent, it spent while paying us
        -- nothing, it spent more than it pays.
        case when s.ai_cost_30d > 0 then 'ai_cost' end,
        case
          when s.ai_cost_30d > 0 and (s.provider_subscription_id is null or coalesce(s.is_free, true))
          then 'ai_cost_unpaid'
        end,
        case
          when s.ai_cost_30d_cents is not null and s.monthly_cents > 0
            and s.ai_cost_30d_cents > s.monthly_cents
          then 'ai_cost_over_revenue'
        end
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
      'currency', coalesce(min(currency) filter (where not coalesce(is_free, true)), 'BRL'),
      -- What the accounts cost us in the same window…
      'aiCost30dUsdMicros', coalesce(sum(ai_cost_30d), 0),
      'aiCost30dCents', sum(ai_cost_30d_cents),
      -- …what the platform spends on nobody's behalf (admin insights, shared
      -- library ingestion), which no account should be blamed for…
      'aiPlatformCost30dUsdMicros', (
        select coalesce(sum(s.cost_usd_micros), 0) from public.ai_spend s
        where s.org_id is null and s.occurred_at >= now() - interval '30 days'
      ),
      -- …and how much of it we could not price at all.
      'aiUnpricedCalls30d', coalesce(sum(ai_unpriced_30d), 0),
      'aiCostAccounts', count(*) filter (where ai_cost_30d > 0),
      'aiCostUnpaid', count(*) filter (where 'ai_cost_unpaid' = any(flags)),
      'aiCostOverRevenue', count(*) filter (where 'ai_cost_over_revenue' = any(flags)),
      'usdToBrl', (select usd_to_brl from price_book),
      'aiMeasuringSince', (select min(occurred_at) from public.ai_spend where not estimated)
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
          'aiCost', jsonb_build_object(
            'usdMicros30d', ai_cost_30d,
            -- NULL unless a rate is configured — see the header.
            'cents30d', ai_cost_30d_cents,
            'calls30d', ai_calls_30d,
            'unpriced30d', ai_unpriced_30d,
            'lifetimeUsdMicros', ai_cost_lifetime,
            'lastAt', ai_last_at,
            'byFeature30d', ai_by_feature_30d,
            -- What is left of this account's monthly revenue after its AI
            -- bill. NULL when either half is unknown.
            'marginCents', case
              when ai_cost_30d_cents is not null and monthly_cents > 0
              then monthly_cents - ai_cost_30d_cents
            end
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
  'Superadmin account management view: identity, plan, renewal, trial, minutes, usage, origin and AI cost for every workspace, plus the totals behind the summary tiles.';

revoke all on function public.admin_accounts_overview() from public, anon;
-- `is_superadmin()` inside the function is the real gate; the grant only lets
-- an authenticated session reach it.
grant execute on function public.admin_accounts_overview() to authenticated;
