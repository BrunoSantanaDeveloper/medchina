-- ---------------------------------------------------------------------------
-- 0112 — Leads (docs/FUNIL.md T2.0) e eventos ao vivo (docs/PAGINA-EVENTO.md)
-- ---------------------------------------------------------------------------
-- The first public form in this product that writes to the database, and the
-- first personal data of people who have NO account. Four decisions shape it:
--
--   1. ONE lead entity for the platform, not one table per campaign. FUNIL T2.0
--      specified it; T1.4 (waitlist), T3.3 (masterclass) and T6.4 (contact
--      management) all persist into it. A person is a row in `leads`; taking
--      part in an event is a row in `live_event_registrations`.
--
--   2. Event configuration lives in `live_events`, NOT in `platform_settings`.
--      platform_settings is readable by anon through PostgREST (0018:21-23), and
--      an event carries the Community invite link and the stream — which must
--      not be readable by anyone holding the public key. This table also
--      replaces the `masterclass` key D7 of the FUNIL had reserved: the
--      masterclass becomes another row here.
--
--   3. Consent is pinned on the row, not in `consent_acceptances`: that table
--      requires an organization (0005:137) and is RPC-only (0040:154-157), and a
--      lead has no organization. Term id + version + the exact text she saw are
--      stored with the date (FUNIL T2.4, option b; snapshot pattern of 0102).
--      Two terms, two purposes: the event contact is required for what she
--      asked for; news and ad audiences are OPTIONAL and never condition the
--      event.
--
--   4. Erasure is real. Every versioned table here keeps a full snapshot of
--      every write in `record_versions` (0005), which has no foreign key: a
--      plain DELETE would leave the phone number there verbatim. Deletion goes
--      through `purge_leads_internal`, which removes the versions too (the lesson
--      of 0099:16-20). Retention (six months after the last event, unless she
--      opted into news) is enforced by `purge_expired_leads`, run daily.
--
-- Written by the service role only: the public page never talks to these tables.
-- Read and managed by the platform superadmin in /admin/leads.

-- ---------- Events ----------

create table if not exists public.live_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Always displayed in Brasília time. Null only while the event is a draft.
  starts_at timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 15 and 480),
  state text not null default 'rascunho'
    check (state in ('rascunho', 'inscricoes', 'ao_vivo', 'encerrado')),
  -- The WhatsApp number that owns the event's Community: the "Receive the link
  -- on my WhatsApp" button and the console's 1:1 conversations come from it.
  -- Configurable by the superadmin, never hardcoded.
  owner_phone text check (owner_phone is null or owner_phone ~ '^55[1-9][0-9]9[0-9]{8}$'),
  group_invite_url text check (
    group_invite_url is null
    or (char_length(group_invite_url) <= 120 and group_invite_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]+$')
  ),
  stream_url text check (stream_url is null or char_length(stream_url) <= 300),
  recording_url text check (recording_url is null or char_length(recording_url) <= 300),
  -- New registrations per network (hashed IP) per hour. A starting point with
  -- no measurement behind it: calibrated in the rehearsal, changed in the
  -- console, never by deploy. Loose on purpose — mobile carriers put many
  -- people behind one IP (CGNAT).
  ip_window_limit integer not null default 20 check (ip_window_limit between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint live_events_date_unless_draft check (state = 'rascunho' or starts_at is not null)
);

comment on table public.live_events is
  'Live events (docs/PAGINA-EVENTO.md). Holds the Community invite and the stream, so it is NOT anon-readable: the public page reads it with the service role and renders only what its state allows.';

-- ---------- Leads (T2.0) ----------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Brazilian mobile, normalized: 11 digits, no country code, no mask
  -- (packages/fields normalizeMobileBr). One person, one row.
  phone text not null unique check (phone ~ '^[1-9][0-9]9[0-9]{8}$'),
  email text check (
    email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  -- Campaign vocabulary of the repo (signup_attribution 0086, FUNIL T6.4).
  segmento text not null default 'live'
    check (segmento in ('ex_pagante', 'cadastro_v1', 'live', 'escola', 'indicacao', 'gratuito_parado', 'waitlist')),
  onda text,
  cupom text,
  -- First touch, from the middleware's attribution cookie: the same nine fields
  -- persistSignupAttribution writes. Never updated afterwards.
  origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  landing_path text,
  -- News and ad audiences: OPTIONAL consent, separate from any event.
  marketing_term_id uuid references public.consent_terms (id),
  marketing_term_version integer,
  marketing_term_text text,
  marketing_accepted_at timestamptz,
  marketing_revoked_at timestamptz,
  -- Left everything (replied SAIR, asked us, or the e-mail unsubscribe of
  -- everything). No contact, no export while set.
  opted_out_at timestamptz,
  email_unsubscribe_token uuid not null unique default gen_random_uuid(),
  email_opt_out_at timestamptz,
  -- Query parameters are attacker-controlled; the app bounds them and so does this.
  constraint leads_lengths check (
    coalesce(length(onda), 0) <= 64
    and coalesce(length(cupom), 0) <= 64
    and coalesce(length(origem), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
    and coalesce(length(utm_term), 0) <= 64
    and coalesce(length(referrer), 0) <= 255
    and coalesce(length(landing_path), 0) <= 255
  ),
  constraint leads_marketing_consent_whole check (
    (marketing_term_id is null and marketing_term_version is null and marketing_term_text is null and marketing_accepted_at is null)
    or (marketing_term_id is not null and marketing_term_version is not null and marketing_term_text is not null and marketing_accepted_at is not null)
  )
);

comment on table public.leads is
  'Platform-level contacts without an account (FUNIL T2.0). Superadmin-only. Consent pinned on the row; erasure via purge_lead / purge_expired_leads, which also remove record_versions.';

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_origem_idx on public.leads (origem, created_at desc);

-- ---------- Registrations ----------

create table if not exists public.live_event_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null references public.live_events (id) on delete restrict,
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- The event term, pinned: id + version + the text she was shown.
  contact_term_id uuid not null references public.consent_terms (id),
  contact_term_version integer not null,
  contact_term_text text not null,
  contact_accepted_at timestamptz not null default now(),
  -- Last touch of THIS registration, from the page's own URL: which channel
  -- brought the registration (the lead keeps the first touch).
  origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  -- sha256(IP + server salt), for the per-network window. Never the raw IP.
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  -- Registered with the event already closed (the "send me the recording" capture).
  after_event boolean not null default false,
  group_clicked_at timestamptz,
  whatsapp_started_at timestamptz,
  last_whatsapp_opened_at timestamptz,
  email_confirmation_sent_at timestamptz,
  email_day_before_sent_at timestamptz,
  email_hour_before_sent_at timestamptz,
  email_live_sent_at timestamptz,
  email_recording_sent_at timestamptz,
  constraint live_event_registrations_lengths check (
    coalesce(length(origem), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
  ),
  unique (event_id, lead_id)
);

create index if not exists live_event_registrations_event_idx
  on public.live_event_registrations (event_id, created_at desc);
create index if not exists live_event_registrations_lead_idx
  on public.live_event_registrations (lead_id);
create index if not exists live_event_registrations_ip_idx
  on public.live_event_registrations (ip_hash, created_at desc) where ip_hash is not null;

-- ---------- Tokens (cookie + personal link) ----------
-- Several per registration — one per device she registered on — and all of them
-- stay valid: rotating would kill the personal link already sent by e-mail.
-- Only the sha256 reaches the database (pattern of 0040/0053). Not versioned,
-- like those token tables: operational, no consent content.

create table if not exists public.live_event_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  registration_id uuid not null references public.live_event_registrations (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists live_event_tokens_registration_idx
  on public.live_event_tokens (registration_id, created_at desc);

-- ---------- Presence ----------
-- Apart from the registration because the heartbeat writes every minute per
-- viewer: on a versioned table that would be one row in record_versions per
-- minute per person. Not versioned, on purpose.

create table if not exists public.live_event_presence (
  registration_id uuid primary key references public.live_event_registrations (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  watched_seconds integer not null default 0 check (watched_seconds between 0 and 86400)
);

-- ---------- updated_at ----------

drop trigger if exists live_events_updated_at on public.live_events;
create trigger live_events_updated_at
  before update on public.live_events
  for each row execute function public.set_updated_at();

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Who changed the event last, stamped by the database from the session: the
-- console never has to remember to send it. A server-side write (no user)
-- keeps whatever the row already said.
create or replace function public.live_events_stamp_updater()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists live_events_updated_by on public.live_events;
create trigger live_events_updated_by
  before update on public.live_events
  for each row execute function public.live_events_stamp_updater();

-- ---------- Versioning (FUNIL §0.5) ----------

select public.enable_row_versioning('public.live_events');
select public.enable_row_versioning('public.leads');
select public.enable_row_versioning('public.live_event_registrations');

-- ---------- RLS ----------
-- The legacy baseline grants ALL to anon/authenticated on new objects
-- (supabase-legacy-privilege-baseline): revokes are by role, by name.

alter table public.live_events enable row level security;
alter table public.leads enable row level security;
alter table public.live_event_registrations enable row level security;
alter table public.live_event_tokens enable row level security;
alter table public.live_event_presence enable row level security;

drop policy if exists "live_events_superadmin" on public.live_events;
create policy "live_events_superadmin" on public.live_events
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists "leads_superadmin" on public.leads;
create policy "leads_superadmin" on public.leads
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists "live_event_registrations_superadmin" on public.live_event_registrations;
create policy "live_event_registrations_superadmin" on public.live_event_registrations
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists "live_event_presence_select_superadmin" on public.live_event_presence;
create policy "live_event_presence_select_superadmin" on public.live_event_presence
  for select to authenticated
  using (public.is_superadmin());

-- Tokens: no policy at all. Only the service role (which bypasses RLS) sees them.

revoke all on table public.live_events from anon;
revoke all on table public.leads from anon;
revoke all on table public.live_event_registrations from anon;
revoke all on table public.live_event_tokens from anon, authenticated;
revoke all on table public.live_event_presence from anon;

-- Deleting a lead must go through purge_lead, which also clears the history.
revoke delete, truncate on table public.leads from authenticated;
revoke insert, delete, truncate on table public.live_event_registrations from authenticated;
revoke delete, truncate on table public.live_events from authenticated;
revoke insert, update, delete, truncate on table public.live_event_presence from authenticated;

-- ---------- Consent terms (definitive text, reviewed 2026-09-26) ----------

insert into public.consent_terms (slug, version, title, body, is_active)
select
  'evento-contato', 1,
  'Contato sobre o evento',
  'Ao se inscrever, você autoriza o MedChina Gestão e Prontuários (CNPJ 38.504.491/0001-80) a usar o seu nome, '
  'o seu WhatsApp e, se você informar, o seu e-mail para enviar o link, os lembretes e a gravação deste evento. '
  'O grupo de avisos do evento no WhatsApp só recebe mensagens da equipe e não mostra o seu número aos outros '
  'participantes. Também registramos se você entrou no grupo, se assistiu e por quanto tempo, para organizar o evento, '
  'e de qual link você chegou até a inscrição. Esses dados são eliminados seis meses depois do evento, a menos que '
  'você também autorize receber novidades do MedChina. Você pode sair quando quiser: responda SAIR no WhatsApp, use '
  'o link de descadastro dos e-mails ou escreva para contato@medchinaprontuarios.com.br.',
  true
where not exists (
  select 1 from public.consent_terms t where t.slug = 'evento-contato' and t.version = 1
);

insert into public.consent_terms (slug, version, title, body, is_active)
select
  'medchina-novidades', 1,
  'Novidades e anúncios do MedChina',
  'Marcando esta opção, você autoriza o MedChina Gestão e Prontuários (CNPJ 38.504.491/0001-80) a enviar novidades, '
  'conteúdos e condições comerciais do MedChina pelo WhatsApp e, se você informou, por e-mail, e a usar o seu WhatsApp '
  'e o seu e-mail, transformados em código irreversível, para montar públicos de anúncio do MedChina na Meta '
  '(Facebook e Instagram). Esta autorização é opcional e não muda nada na sua inscrição no evento. Você pode retirá-la '
  'quando quiser, respondendo SAIR no WhatsApp, pelo link de descadastro dos e-mails ou por '
  'contato@medchinaprontuarios.com.br; a partir daí o seu contato deixa de ser usado para esses fins.',
  true
where not exists (
  select 1 from public.consent_terms t where t.slug = 'medchina-novidades' and t.version = 1
);

-- ---------- The first event ----------
-- A draft: the page answers 404 until the superadmin sets the date and opens
-- registrations in /admin/leads. No date is invented here.

insert into public.live_events (slug, title, state)
values (
  'lei-15345',
  'O que muda para o acupunturista brasileiro depois da Lei 15.345 — e o que eu vi na China',
  'rascunho'
)
on conflict (slug) do nothing;

-- ---------- Last-touch campaign at checkout (PAGINA-EVENTO.md §11) ----------
-- First touch (0086) is written once per workspace, so the base that already
-- has an account would never be credited to an event. meta_attribution is
-- rewritten on every checkout — last touch by construction — and the webhook
-- already reads it to enrich Purchase.

alter table public.meta_attribution
  add column if not exists campaign_origem text,
  add column if not exists campaign_utm_source text,
  add column if not exists campaign_utm_medium text,
  add column if not exists campaign_utm_campaign text,
  add column if not exists campaign_utm_content text,
  add column if not exists campaign_captured_at timestamptz;

alter table public.meta_attribution drop constraint if exists meta_attribution_campaign_lengths;
alter table public.meta_attribution add constraint meta_attribution_campaign_lengths check (
  coalesce(length(campaign_origem), 0) <= 64
  and coalesce(length(campaign_utm_source), 0) <= 64
  and coalesce(length(campaign_utm_medium), 0) <= 64
  and coalesce(length(campaign_utm_campaign), 0) <= 64
  and coalesce(length(campaign_utm_content), 0) <= 64
);

-- ---------- Registration ----------

create or replace function public.submit_live_event_registration(
  target_slug text,
  target_name text,
  target_phone text,
  target_email text,
  target_marketing boolean,
  target_ip_hash text,
  target_token_hash text,
  target_first_touch jsonb,
  target_touch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.live_events%rowtype;
  contact_term public.consent_terms%rowtype;
  marketing_term public.consent_terms%rowtype;
  found_lead public.leads%rowtype;
  lead_row uuid;
  reg_row uuid;
  lead_created boolean := false;
  reg_created boolean := false;
  recent integer;
  clean_name text := btrim(coalesce(target_name, ''));
  clean_email text := nullif(lower(btrim(coalesce(target_email, ''))), '');
  first_touch jsonb := coalesce(target_first_touch, '{}'::jsonb);
  touch jsonb := coalesce(target_touch, '{}'::jsonb);
  confirmation_to text;
begin
  -- The server only. A client that could call this would write leads with no
  -- rate limit and no honeypot in front of it.
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select * into ev from public.live_events where slug = target_slug;
  if ev.id is null or ev.state = 'rascunho' then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;

  -- The app validates first; this is the fence for a caller that forgets.
  if coalesce(target_phone, '') !~ '^[1-9][0-9]9[0-9]{8}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;
  if char_length(clean_name) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name');
  end if;
  if clean_email is not null
     and (char_length(clean_email) > 254 or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
     or (target_ip_hash is not null and target_ip_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- The current version of each term — the one the page showed.
  select * into contact_term from public.consent_terms
    where slug = 'evento-contato' and is_active order by version desc limit 1;
  if contact_term.id is null then
    return jsonb_build_object('ok', false, 'code', 'term_missing');
  end if;
  if coalesce(target_marketing, false) then
    select * into marketing_term from public.consent_terms
      where slug = 'medchina-novidades' and is_active order by version desc limit 1;
    if marketing_term.id is null then
      return jsonb_build_object('ok', false, 'code', 'term_missing');
    end if;
  end if;

  -- Per-network window over NEW registrations. Loose: see live_events.ip_window_limit.
  if target_ip_hash is not null then
    select count(*) into recent
      from public.live_event_registrations r
      where r.ip_hash = target_ip_hash and r.created_at > now() - interval '1 hour';
    if recent >= ev.ip_window_limit then
      return jsonb_build_object('ok', false, 'code', 'too_many');
    end if;
  end if;

  -- The person. A repeat NEVER rewrites name or e-mail: otherwise anyone typing
  -- someone else's number could change her data. A repeat is still a new,
  -- explicit act, so it lifts an earlier opt-out and may ADD the optional
  -- consent — never remove it.
  select * into found_lead from public.leads where phone = target_phone for update;
  if found_lead.id is null then
    insert into public.leads (
      name, phone, email, segmento,
      origem, onda, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, landing_path,
      marketing_term_id, marketing_term_version, marketing_term_text, marketing_accepted_at
    ) values (
      clean_name, target_phone, clean_email, 'live',
      left(first_touch ->> 'origem', 64), left(first_touch ->> 'onda', 64),
      left(first_touch ->> 'utm_source', 64), left(first_touch ->> 'utm_medium', 64),
      left(first_touch ->> 'utm_campaign', 64), left(first_touch ->> 'utm_content', 64),
      left(first_touch ->> 'utm_term', 64), left(first_touch ->> 'referrer', 255),
      left(first_touch ->> 'landing_path', 255),
      marketing_term.id, marketing_term.version, marketing_term.body,
      case when marketing_term.id is not null then now() end
    )
    on conflict (phone) do nothing
    returning id into lead_row;

    if lead_row is null then
      select id into lead_row from public.leads where phone = target_phone;
    else
      lead_created := true;
    end if;
  else
    lead_row := found_lead.id;
    update public.leads l
    set opted_out_at = null,
        marketing_term_id = case when marketing_term.id is not null and (l.marketing_accepted_at is null or l.marketing_revoked_at is not null)
                                 then marketing_term.id else l.marketing_term_id end,
        marketing_term_version = case when marketing_term.id is not null and (l.marketing_accepted_at is null or l.marketing_revoked_at is not null)
                                      then marketing_term.version else l.marketing_term_version end,
        marketing_term_text = case when marketing_term.id is not null and (l.marketing_accepted_at is null or l.marketing_revoked_at is not null)
                                   then marketing_term.body else l.marketing_term_text end,
        marketing_accepted_at = case when marketing_term.id is not null and (l.marketing_accepted_at is null or l.marketing_revoked_at is not null)
                                     then now() else l.marketing_accepted_at end,
        marketing_revoked_at = case when marketing_term.id is not null then null else l.marketing_revoked_at end
    where l.id = lead_row
      and (l.opted_out_at is not null
           or (marketing_term.id is not null and (l.marketing_accepted_at is null or l.marketing_revoked_at is not null)));
  end if;

  -- The registration.
  insert into public.live_event_registrations (
    event_id, lead_id, contact_term_id, contact_term_version, contact_term_text,
    origem, utm_source, utm_medium, utm_campaign, utm_content, ip_hash, after_event
  ) values (
    ev.id, lead_row, contact_term.id, contact_term.version, contact_term.body,
    left(touch ->> 'origem', 64), left(touch ->> 'utm_source', 64), left(touch ->> 'utm_medium', 64),
    left(touch ->> 'utm_campaign', 64), left(touch ->> 'utm_content', 64),
    target_ip_hash, ev.state = 'encerrado'
  )
  on conflict (event_id, lead_id) do nothing
  returning id into reg_row;

  if reg_row is null then
    select id into reg_row from public.live_event_registrations
      where event_id = ev.id and lead_id = lead_row;
    -- A repeat mints a token for this device; cap it so the table cannot be
    -- flooded by replaying one number.
    select count(*) into recent from public.live_event_tokens
      where registration_id = reg_row and created_at > now() - interval '1 hour';
    if recent >= 10 then
      return jsonb_build_object('ok', false, 'code', 'too_many');
    end if;
  else
    reg_created := true;
  end if;

  insert into public.live_event_tokens (token_hash, registration_id, expires_at)
  values (target_token_hash, reg_row, coalesce(ev.starts_at, now()) + interval '180 days')
  on conflict (token_hash) do nothing;

  -- The confirmation e-mail goes to the address ON FILE, only for a new
  -- registration, and never to someone who unsubscribed.
  if reg_created then
    select case when l.opted_out_at is null and l.email_opt_out_at is null then l.email end
      into confirmation_to
      from public.leads l where l.id = lead_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', case when reg_created then 'created' else 'existing' end,
    'registration_id', reg_row,
    'lead_created', lead_created,
    'confirmation_email', confirmation_to
  );
end;
$$;

revoke all on function public.submit_live_event_registration(text, text, text, text, boolean, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_live_event_registration(text, text, text, text, boolean, text, text, jsonb, jsonb)
  to service_role;

-- ---------- Touch: group click, conversation started, presence ----------

create or replace function public.touch_live_event_registration(
  target_token_hash text,
  target_kind text,
  target_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reg uuid;
  ev_slug text;
  ev_state text;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
     or target_kind is null or target_kind not in ('group', 'whatsapp', 'presence') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select t.registration_id, e.slug, e.state into reg, ev_slug, ev_state
    from public.live_event_tokens t
    join public.live_event_registrations r on r.id = t.registration_id
    join public.live_events e on e.id = r.event_id
    where t.token_hash = target_token_hash and t.expires_at > now();
  if reg is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Presence is attendance AT the live (docs/PAGINA-EVENTO.md §14: presence ÷
  -- registration judges the reminder). A beat before the start or over the
  -- recording would count someone who was not there.
  if target_kind = 'presence' and ev_state is distinct from 'ao_vivo' then
    return jsonb_build_object('ok', false, 'code', 'not_live');
  end if;

  if target_kind = 'group' then
    update public.live_event_registrations set group_clicked_at = now()
      where id = reg and group_clicked_at is null;
  elsif target_kind = 'whatsapp' then
    update public.live_event_registrations set whatsapp_started_at = now()
      where id = reg and whatsapp_started_at is null;
  else
    -- A heartbeat reports at most two minutes, whatever the client claims.
    insert into public.live_event_presence (registration_id)
    values (reg)
    on conflict (registration_id) do update
      set last_seen_at = now(),
          watched_seconds = least(
            86400,
            public.live_event_presence.watched_seconds + greatest(0, least(coalesce(target_seconds, 0), 120))
          );
  end if;

  return jsonb_build_object('ok', true, 'registration_id', reg, 'event_slug', ev_slug);
end;
$$;

revoke all on function public.touch_live_event_registration(text, text, integer) from public, anon, authenticated;
grant execute on function public.touch_live_event_registration(text, text, integer) to service_role;

-- ---------- Erasure ----------

create or replace function public.purge_leads_internal(target_leads uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  regs uuid[];
  removed integer;
begin
  if target_leads is null or cardinality(target_leads) = 0 then
    return 0;
  end if;

  select coalesce(array_agg(id), '{}') into regs
    from public.live_event_registrations where lead_id = any(target_leads);

  -- Cascades to registrations, tokens and presence. The versioning trigger
  -- writes a DELETE snapshot of each row it removes — cleared right below.
  delete from public.leads where id = any(target_leads);
  get diagnostics removed = row_count;

  delete from public.record_versions
    where (table_name = 'leads' and record_id = any(target_leads))
       or (table_name = 'live_event_registrations' and record_id = any(regs));

  return removed;
end;
$$;

revoke all on function public.purge_leads_internal(uuid[]) from public, anon, authenticated, service_role;

create or replace function public.purge_lead(target_lead uuid, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  removed := public.purge_leads_internal(array[target_lead]);
  if removed = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- The id and the operator's reason only: the name and the phone are exactly
  -- what was just erased. The reason is the one place the WHY survives.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null, auth.uid(), 'admin.leads.purged', 'lead', target_lead::text,
    case when nullif(btrim(target_reason), '') is null then '{}'::jsonb
         else jsonb_build_object('reason', left(btrim(target_reason), 500)) end
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.purge_lead(uuid, text) from public, anon;
grant execute on function public.purge_lead(uuid, text) to authenticated;

-- Retention: no active consent for news, and the last event she registered for
-- started more than six months ago (docs/PAGINA-EVENTO.md §9; privacy-8).
create or replace function public.purge_expired_leads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doomed uuid[];
  removed integer;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select coalesce(array_agg(l.id), '{}') into doomed
    from public.leads l
    where (l.marketing_accepted_at is null or l.marketing_revoked_at is not null)
      and exists (select 1 from public.live_event_registrations r where r.lead_id = l.id)
      and not exists (
        select 1
        from public.live_event_registrations r
        join public.live_events e on e.id = r.event_id
        where r.lead_id = l.id
          and coalesce(e.starts_at, r.created_at) > now() - interval '6 months'
      );

  removed := public.purge_leads_internal(doomed);

  if removed > 0 then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (null, null, 'leads.retention_purged', 'lead', null, jsonb_build_object('count', removed));
  end if;

  return jsonb_build_object('ok', true, 'removed', removed);
end;
$$;

revoke all on function public.purge_expired_leads() from public, anon, authenticated;
grant execute on function public.purge_expired_leads() to service_role;
