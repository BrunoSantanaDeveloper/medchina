-- ---------------------------------------------------------------------------
-- 0113 — Eventos ao vivo: vários eventos, página por modelo, resultados por evento
-- ---------------------------------------------------------------------------
-- 0112 modelled many events (one row each, registrations keyed by event) but
-- the product around it assumed one: a hardcoded page, routes that loaded the
-- first event by slug, one cookie slot, e-mail subjects naming Lei 15.345, and
-- no way to create an event without SQL. This migration gives the console what
-- it needs to run events one after another, each with its own page and its own
-- results:
--
--   1. The page's CONTENT is data on the event (headline, lead, topics,
--      audience, link-preview description) rendered by one Landing DS
--      template, so a new event is a console action, not a deploy. Partners
--      have NO registry of their own (owner's decision, 2026-09-28): a partner
--      is named in the event's own byline and copy.
--   2. What an ENDED event's page does is a per-event choice made in the
--      console: keep showing the recording with the short capture, or redirect
--      to another address of this site.
--   3. Lifecycle rules live in the database, not only in the screen: an event
--      is created as a draft; its slug freezes once it leaves the draft or has
--      a registration (it is printed in e-mails, ads and QR codes); only an
--      empty draft can be deleted; anything else is archived.
--   4. Per-event results need three facts 0112 did not keep: page visits by
--      channel (counted server-side, no personal data), the device of the group
--      click (the spec splits that rate by phone and computer — kept as an
--      aggregate per event, never on the person: the contact term she accepted
--      does not mention it), and the purchases each campaign produced —
--      `meta_attribution` is one row per workspace, rewritten by the next
--      checkout, so a durable record is kept per paid invoice.
--   5. With many events, a registration made by someone who typed ANOTHER
--      person's number reaches further than with one: it would lift her opt-out,
--      re-grant a consent she revoked, and e-mail her for an event she never
--      chose. `submit_live_event_registration` is redefined so an unverified
--      form post never does any of that.

-- ---------- Event content and lifecycle ----------

alter table public.live_events
  -- "a Lei 15.345": how the event is named inside a sentence — "o ao vivo sobre
  -- ___" in e-mail subjects and WhatsApp messages.
  add column if not exists topic text,
  -- The page's h1. `**accent**` marks the emphasized tail (the DS <em>).
  add column if not exists headline text,
  add column if not exists byline text not null default 'com Debora Giovanella, fundadora do MedChina',
  add column if not exists lead text,
  -- Optional: the same lead in the past tense, shown once the event is over.
  add column if not exists lead_after text,
  -- Up to three "what you will see" items: [{ "icon": "<key>", "text": "…" }].
  add column if not exists topics jsonb not null default '[]'::jsonb,
  add column if not exists audience_heading text,
  add column if not exists audience text,
  -- Page description and link preview (WhatsApp shows it under the title).
  add column if not exists description text,
  add column if not exists ended_behavior text not null default 'recording',
  add column if not exists ended_redirect_path text,
  add column if not exists archived_at timestamptz,
  -- The tab and link-preview title, when it should differ from the title.
  add column if not exists page_title text,
  -- The /assinar angle the event's subscribe button opens (lib/offer-angles.ts):
  -- it leads the button's utm_content, which /assinar reads.
  add column if not exists offer_angle text,
  -- Stamped once, the first time the event leaves the draft: from then on the
  -- address is printed somewhere and the event can no longer be deleted, even
  -- if it is moved back to a draft.
  add column if not exists published_at timestamptz;

create or replace function public.live_event_topics_valid(value jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- CASE, not AND/OR: SQL does not promise evaluation order, and
  -- jsonb_array_length / jsonb_object_keys raise on the wrong type instead of
  -- answering false.
  select case
    when jsonb_typeof(value) is distinct from 'array' then false
    when jsonb_array_length(value) > 3 then false
    else not exists (
      select 1
      from jsonb_array_elements(value) item
      where case
        when jsonb_typeof(item) <> 'object' then true
        when (select count(*) from jsonb_object_keys(item)) <> 2 then true
        when coalesce(item ->> 'icon', '') not in (
          'lei', 'apresentacao', 'consulta', 'conversa', 'livro', 'grafico', 'pessoas', 'coracao', 'folha', 'video'
        ) then true
        when char_length(btrim(coalesce(item ->> 'text', ''))) not between 1 and 200 then true
        else false
      end
    )
  end;
$$;

alter table public.live_events drop constraint if exists live_events_content_lengths;
alter table public.live_events add constraint live_events_content_lengths check (
  (topic is null or char_length(btrim(topic)) between 1 and 80)
  and (headline is null or char_length(btrim(headline)) between 1 and 220)
  and char_length(btrim(byline)) between 1 and 140
  and (lead is null or char_length(lead) <= 600)
  and (lead_after is null or char_length(lead_after) <= 600)
  and (audience_heading is null or char_length(audience_heading) <= 140)
  and (audience is null or char_length(audience) <= 600)
  and (description is null or char_length(description) <= 200)
  and (page_title is null or char_length(btrim(page_title)) between 1 and 120)
  and (offer_angle is null or offer_angle ~ '^[a-z]{2,32}$')
);

alter table public.live_events drop constraint if exists live_events_topics_shape;
alter table public.live_events add constraint live_events_topics_shape check (public.live_event_topics_valid(topics));

-- The redirect is an address of THIS site: a path, never a scheme or a
-- protocol-relative "//host" (an open redirect with our domain on it).
alter table public.live_events drop constraint if exists live_events_ended_behavior;
alter table public.live_events add constraint live_events_ended_behavior check (
  ended_behavior in ('recording', 'redirect')
  and (
    ended_redirect_path is null
    or (char_length(ended_redirect_path) <= 200 and ended_redirect_path ~ '^/([A-Za-z0-9_-][A-Za-z0-9/_.~%=&?#-]*)?$')
  )
  and (ended_behavior = 'recording' or ended_redirect_path is not null)
);

-- Only what is not running can be put away: a draft nobody will publish, or an
-- event that is over. An archived event keeps its page behaviour and its data.
alter table public.live_events drop constraint if exists live_events_archive_state;
alter table public.live_events add constraint live_events_archive_state check (
  archived_at is null or state in ('rascunho', 'encerrado')
);

-- The slug is the address. Once the event was ever published, or someone
-- registered, it is printed in e-mails, ads and QR codes: renaming it would
-- break them all. `published_at` is stamped here, once, and never cleared —
-- moving an event back to a draft does not make it unpublished.
create or replace function public.live_events_guard_slug()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.published_at := coalesce(old.published_at, new.published_at);
    if new.slug is distinct from old.slug
       and (old.published_at is not null
            or old.state <> 'rascunho'
            or exists (select 1 from public.live_event_registrations r where r.event_id = old.id)) then
      raise exception 'live_event_slug_locked' using errcode = 'check_violation';
    end if;
  end if;
  if new.state <> 'rascunho' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists live_events_guard_slug on public.live_events;
create trigger live_events_guard_slug
  before insert or update on public.live_events
  for each row execute function public.live_events_guard_slug();

update public.live_events set published_at = updated_at where state <> 'rascunho' and published_at is null;

-- The first event keeps exactly the page it had (0112 rendered it from code).
-- "Este encontro" replaces "esta noite"/"esta gravação": one text that reads
-- right before and after the live.
update public.live_events
set topic = 'a Lei 15.345',
    headline = 'O que muda para o acupunturista brasileiro depois da Lei 15.345 **e o que eu vi na China.**',
    lead = 'Em janeiro, a acupuntura virou profissão regulamentada no Brasil. Em setembro, eu levei o MedChina ao Congresso de MTC em Xinjiang, na China. Nesta noite eu conto as duas coisas, e o que elas mudam no seu consultório.',
    lead_after = 'Em janeiro, a acupuntura virou profissão regulamentada no Brasil. Em setembro, eu levei o MedChina ao Congresso de MTC em Xinjiang, na China. No ao vivo eu contei as duas coisas, e o que elas mudam no seu consultório.',
    topics = '[
      {"icon": "lei", "text": "Quem pode exercer a acupuntura segundo a Lei 15.345, e o que muda na prática do consultório depois dela"},
      {"icon": "apresentacao", "text": "O que eu apresentei no Congresso de MTC em Xinjiang, e o que vi por lá"},
      {"icon": "consulta", "text": "Uma consulta simulada, com paciente e diálogo fictícios, registrada do começo ao fim sem ninguém digitar durante o atendimento"}
    ]'::jsonb,
    audience_heading = 'Para quem registra **o que atende.**',
    audience = 'Para quem atende com acupuntura ou MTC e registra as consultas — em papel, em caderno, em qualquer sistema. Se você nunca registrou nada e não pretende começar, este encontro não vai te servir.',
    description = 'Debora Giovanella, fundadora do MedChina, conta ao vivo o que muda para o acupunturista brasileiro depois da Lei 15.345 e o que viu no Congresso de MTC em Xinjiang, na China.'
where slug = 'lei-15345' and headline is null;

-- Its tab/preview title and the China angle of its subscribe button, as the
-- page had them in code (utm_content=china-lei15345-…, read by /assinar).
update public.live_events
set page_title = 'Ao vivo: o que muda depois da Lei 15.345',
    offer_angle = 'china'
where slug = 'lei-15345' and page_title is null and offer_angle is null;

-- ---------- Duplicate / delete ----------

-- Copies what describes the event (content, owner number, limits, behaviour
-- after it ends) — never its registrations, date, state, stream or recording,
-- which belong to the edition that happened.
create or replace function public.duplicate_live_event(target_event uuid, target_slug text, target_title text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source public.live_events%rowtype;
  new_id uuid;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  select * into source from public.live_events where id = target_event;
  if source.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if coalesce(target_slug, '') !~ '^[a-z0-9][a-z0-9-]{2,59}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_slug');
  end if;
  if exists (select 1 from public.live_events where slug = target_slug) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken');
  end if;
  if char_length(btrim(coalesce(target_title, ''))) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_title');
  end if;

  insert into public.live_events (
    slug, title, state, duration_minutes, owner_phone, ip_window_limit,
    topic, headline, byline, lead, lead_after, topics, audience_heading, audience, description,
    page_title, offer_angle, ended_behavior, ended_redirect_path, updated_by
  ) values (
    target_slug, btrim(target_title), 'rascunho', source.duration_minutes, source.owner_phone, source.ip_window_limit,
    source.topic, source.headline, source.byline, source.lead, source.lead_after, source.topics,
    source.audience_heading, source.audience, source.description,
    source.page_title, source.offer_angle, source.ended_behavior, source.ended_redirect_path, auth.uid()
  )
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'admin.events.duplicated', 'live_event', new_id::text,
          jsonb_build_object('source', source.slug, 'slug', target_slug));

  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

revoke all on function public.duplicate_live_event(uuid, text, text) from public, anon;
grant execute on function public.duplicate_live_event(uuid, text, text) to authenticated;

-- Delete is for a draft nobody reached. An event that was EVER published (even
-- if moved back to a draft), or one with any registration, has an address in
-- circulation, consent evidence or results: it is archived instead (and the FK
-- from registrations refuses the delete anyway).
create or replace function public.delete_live_event(target_event uuid, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.live_events%rowtype;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  select * into ev from public.live_events where id = target_event for update;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if ev.state <> 'rascunho' then
    return jsonb_build_object('ok', false, 'code', 'not_draft');
  end if;
  if ev.published_at is not null then
    return jsonb_build_object('ok', false, 'code', 'was_published');
  end if;
  if exists (select 1 from public.live_event_registrations where event_id = ev.id) then
    return jsonb_build_object('ok', false, 'code', 'has_registrations');
  end if;

  delete from public.live_events where id = ev.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'admin.events.deleted', 'live_event', ev.id::text,
          case when nullif(btrim(target_reason), '') is null then jsonb_build_object('slug', ev.slug)
               else jsonb_build_object('slug', ev.slug, 'reason', left(btrim(target_reason), 500)) end);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_live_event(uuid, text) from public, anon;
grant execute on function public.delete_live_event(uuid, text) to authenticated;

-- ---------- Device of the group click ----------
-- The spec splits "clicked the group ÷ registered" by phone and computer: on a
-- computer without WhatsApp Desktop the number measures the device, not the
-- button. An AGGREGATE per event, incremented on a registration's FIRST click,
-- never a column on the person: the contact term she accepted lists what is
-- recorded about her, and the device is not in it.

create table if not exists public.live_event_device_clicks (
  event_id uuid not null references public.live_events (id) on delete cascade,
  device text not null check (device in ('phone', 'computer')),
  clicks integer not null default 0 check (clicks >= 0),
  primary key (event_id, device)
);

alter table public.live_event_device_clicks enable row level security;

drop policy if exists "live_event_device_clicks_select_superadmin" on public.live_event_device_clicks;
create policy "live_event_device_clicks_select_superadmin" on public.live_event_device_clicks
  for select to authenticated
  using (public.is_superadmin());

revoke all on table public.live_event_device_clicks from anon;
revoke insert, update, delete, truncate on table public.live_event_device_clicks from authenticated;

drop function if exists public.touch_live_event_registration(text, text, integer);

create or replace function public.touch_live_event_registration(
  target_token_hash text,
  target_kind text,
  target_seconds integer default 0,
  target_device text default null
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
     or target_kind is null or target_kind not in ('group', 'whatsapp', 'presence')
     or (target_device is not null and target_device not in ('phone', 'computer')) then
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

  -- Presence is attendance AT the live (docs/PAGINA-EVENTO.md §14).
  if target_kind = 'presence' and ev_state is distinct from 'ao_vivo' then
    return jsonb_build_object('ok', false, 'code', 'not_live');
  end if;

  if target_kind = 'group' then
    update public.live_event_registrations
       set group_clicked_at = now()
     where id = reg and group_clicked_at is null;
    -- Her FIRST click only, counted per event and device, never stored on her.
    if found and target_device is not null then
      insert into public.live_event_device_clicks (event_id, device, clicks)
      select r.event_id, target_device, 1 from public.live_event_registrations r where r.id = reg
      on conflict (event_id, device) do update
        set clicks = public.live_event_device_clicks.clicks + 1;
    end if;
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

revoke all on function public.touch_live_event_registration(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.touch_live_event_registration(text, text, integer, text) to service_role;

-- ---------- Page visits ----------
-- Counted by the page's server render (crawlers, drafts and operators excluded),
-- per event, per day in Brasília, per channel. A counter, not a log: no IP, no
-- user agent, no person — "registered ÷ visited" by channel is all it answers.

create table if not exists public.live_event_page_views (
  event_id uuid not null references public.live_events (id) on delete cascade,
  day date not null,
  origem text not null default '' check (char_length(origem) <= 64),
  views integer not null default 0 check (views >= 0),
  primary key (event_id, day, origem)
);

alter table public.live_event_page_views enable row level security;

drop policy if exists "live_event_page_views_select_superadmin" on public.live_event_page_views;
create policy "live_event_page_views_select_superadmin" on public.live_event_page_views
  for select to authenticated
  using (public.is_superadmin());

revoke all on table public.live_event_page_views from anon;
revoke insert, update, delete, truncate on table public.live_event_page_views from authenticated;

-- One spelling per channel, for visits AND registrations: lower case, letters,
-- digits, "_" and "-", at most 32 characters; nothing left means "direto". The
-- query string is attacker-controlled — without this every made-up `?origem=`
-- would be a row and a label in the operator's console.
create or replace function public.live_event_channel(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(left(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9_-]+', '', 'g'), 32), ''), 'direto');
$$;

create or replace function public.count_live_event_view(target_slug text, target_origem text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev_id uuid;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  channel text := public.live_event_channel(target_origem);
begin
  if auth.role() is distinct from 'service_role' then
    return;
  end if;
  select id into ev_id from public.live_events where slug = target_slug and state <> 'rascunho';
  if ev_id is null then
    return;
  end if;
  -- At most 30 channels per event per day; anything past that is "outro", so
  -- a flood of invented channels cannot grow the table or the console.
  if not exists (
       select 1 from public.live_event_page_views v
       where v.event_id = ev_id and v.day = today and v.origem = channel)
     and (select count(*) from public.live_event_page_views v where v.event_id = ev_id and v.day = today) >= 30 then
    channel := 'outro';
  end if;
  insert into public.live_event_page_views (event_id, day, origem, views)
  values (ev_id, today, channel, 1)
  on conflict (event_id, day, origem) do update
    set views = public.live_event_page_views.views + 1;
end;
$$;

revoke all on function public.count_live_event_view(text, text) from public, anon, authenticated;
grant execute on function public.count_live_event_view(text, text) to service_role;

-- ---------- Registration, redefined for many events ----------
-- Three changes to 0112's function, all about what a form post can prove. It
-- does NOT prove the number is the typist's: a repeat was harmless with one
-- event ("existing", nothing rewritten), but a SECOND event is a new
-- registration for the same person, and 0112 then lifted her opt-out, could
-- re-grant a consent she had revoked, and e-mailed her stored address.
--   1. An opt-out recorded by the team (she replied SAIR, asked us) is never
--      lifted by a form. She can still register and join the group herself;
--      the team reverses it by hand if she asks.
--   2. The optional news consent may be ADDED to an existing person only if
--      she never had it and has not left — never re-granted after a revocation.
--   3. The confirmation e-mail goes to a NEW person (the address she just
--      typed), or to an existing one only when the typed address matches the
--      stored one: knowing the address is the proof.
-- And the per-network window is per event, like the limit it reads from.

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

  -- Per-network window over NEW registrations OF THIS EVENT. Loose: see
  -- live_events.ip_window_limit.
  if target_ip_hash is not null then
    select count(*) into recent
      from public.live_event_registrations r
      where r.ip_hash = target_ip_hash and r.event_id = ev.id and r.created_at > now() - interval '1 hour';
    if recent >= ev.ip_window_limit then
      return jsonb_build_object('ok', false, 'code', 'too_many');
    end if;
  end if;

  -- The person. A later registration NEVER rewrites name or e-mail, never lifts
  -- an opt-out and never re-grants a revoked consent (see the header).
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
      select * into found_lead from public.leads where id = lead_row;
    else
      lead_created := true;
    end if;
  else
    lead_row := found_lead.id;
  end if;

  if not lead_created
     and marketing_term.id is not null
     and found_lead.marketing_accepted_at is null
     and found_lead.marketing_revoked_at is null
     and found_lead.opted_out_at is null then
    update public.leads
       set marketing_term_id = marketing_term.id,
           marketing_term_version = marketing_term.version,
           marketing_term_text = marketing_term.body,
           marketing_accepted_at = now()
     where id = lead_row;
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

  -- The confirmation e-mail: a NEW registration only, to the address ON FILE,
  -- never to someone who left — and, for a person who already existed, only
  -- when the typed address is that address (the proof it is her).
  if reg_created then
    select case
             when l.opted_out_at is null and l.email_opt_out_at is null
                  and (lead_created or (clean_email is not null and clean_email = lower(l.email)))
             then l.email
           end
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

-- ---------- Purchases per campaign ----------
-- One row per paid invoice that STARTED a subscription with a last-touch
-- campaign captured at its checkout (the billing webhook writes it). It is
-- what "how many purchases did this event produce?" reads: meta_attribution
-- keeps only the latest checkout per workspace, and the Purchase sent to Meta
-- does not come back. Business facts only — workspace, plan, amount, campaign.

create table if not exists public.purchase_attributions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_key text not null unique check (char_length(invoice_key) <= 200),
  subscription_id uuid,
  plan_slug text check (plan_slug is null or char_length(plan_slug) <= 80),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (char_length(currency) between 3 and 8),
  paid_at timestamptz not null,
  origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  campaign_captured_at timestamptz,
  constraint purchase_attributions_lengths check (
    coalesce(length(origem), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
  )
);

create index if not exists purchase_attributions_campaign_idx
  on public.purchase_attributions (utm_campaign, paid_at desc);
create index if not exists purchase_attributions_org_idx
  on public.purchase_attributions (org_id);

alter table public.purchase_attributions enable row level security;

drop policy if exists "purchase_attributions_select_superadmin" on public.purchase_attributions;
create policy "purchase_attributions_select_superadmin" on public.purchase_attributions
  for select to authenticated
  using (public.is_superadmin());

revoke all on table public.purchase_attributions from anon;
revoke insert, update, delete, truncate on table public.purchase_attributions from authenticated;

-- A purchase counts while its invoice is still paid: a refund or a chargeback
-- (revert_paid_invoice) takes it out of the event's numbers without anyone
-- having to remember to delete the attribution.
create or replace function public.purchase_attribution_is_paid(target_invoice_key text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i
    where i.provider::text || ':' || i.provider_invoice_id = target_invoice_key
      and i.status = 'paid'
  );
$$;

-- ---------- Results ----------
-- Security INVOKER on purpose: RLS is the gate (every table read here is
-- superadmin-only), so a non-operator gets empty answers, never another
-- workspace's numbers.

create or replace function public.live_events_overview()
returns table (
  id uuid,
  slug text,
  title text,
  state text,
  starts_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz,
  registrations integer,
  present integer,
  visits integer,
  purchases integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id, e.slug, e.title, e.state, e.starts_at, e.archived_at, e.updated_at,
    (select count(*)::int from public.live_event_registrations r where r.event_id = e.id),
    (select count(*)::int from public.live_event_registrations r
       join public.live_event_presence p on p.registration_id = r.id where r.event_id = e.id),
    (select coalesce(sum(v.views), 0)::int from public.live_event_page_views v where v.event_id = e.id),
    (select count(*)::int from public.purchase_attributions a
       where a.utm_campaign = e.slug and public.purchase_attribution_is_paid(a.invoice_key))
  from public.live_events e
  where public.is_superadmin()
  order by coalesce(e.starts_at, e.created_at) desc;
$$;

revoke all on function public.live_events_overview() from public, anon;
grant execute on function public.live_events_overview() to authenticated;

create or replace function public.live_event_results(target_event uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  ev public.live_events%rowtype;
  result jsonb;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  select * into ev from public.live_events where id = target_event;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select jsonb_build_object(
    'ok', true,
    'registrations', count(*),
    'after_event', count(*) filter (where r.after_event),
    'group_clicked', count(*) filter (where r.group_clicked_at is not null),
    'whatsapp_started', count(*) filter (where r.whatsapp_started_at is not null),
    'present', count(*) filter (where p.registration_id is not null),
    'watched_20', count(*) filter (where coalesce(p.watched_seconds, 0) >= 1200),
    'emails', jsonb_build_object(
      'confirmation', count(*) filter (where r.email_confirmation_sent_at is not null),
      'day_before', count(*) filter (where r.email_day_before_sent_at is not null),
      'hour_before', count(*) filter (where r.email_hour_before_sent_at is not null),
      'live', count(*) filter (where r.email_live_sent_at is not null),
      'recording', count(*) filter (where r.email_recording_sent_at is not null)
    )
  )
  into result
  from public.live_event_registrations r
  left join public.live_event_presence p on p.registration_id = r.id
  where r.event_id = ev.id;

  result := result || jsonb_build_object(
    'visits', coalesce((select sum(views) from public.live_event_page_views where event_id = ev.id), 0),
    'channels', coalesce((
      select jsonb_agg(
        jsonb_build_object('channel', channel, 'visits', visits, 'registrations', registrations)
        order by registrations desc, visits desc, channel
      )
      from (
        select channel, sum(visits)::int as visits, sum(registrations)::int as registrations
        from (
          select public.live_event_channel(v.origem) as channel, v.views as visits, 0 as registrations
            from public.live_event_page_views v where v.event_id = ev.id
          union all
          select public.live_event_channel(coalesce(nullif(r.origem, ''), r.utm_source)), 0, 1
            from public.live_event_registrations r where r.event_id = ev.id
        ) rows
        group by channel
      ) channels
    ), '[]'::jsonb),
    'group_phone', coalesce((select clicks from public.live_event_device_clicks d where d.event_id = ev.id and d.device = 'phone'), 0),
    'group_computer', coalesce((select clicks from public.live_event_device_clicks d where d.event_id = ev.id and d.device = 'computer'), 0),
    'purchases', (select count(*) from public.purchase_attributions a
                    where a.utm_campaign = ev.slug and public.purchase_attribution_is_paid(a.invoice_key)),
    'revenue_cents', coalesce((select sum(amount_cents) from public.purchase_attributions a
                        where a.utm_campaign = ev.slug and public.purchase_attribution_is_paid(a.invoice_key)), 0)
  );

  return result;
end;
$$;

revoke all on function public.live_event_results(uuid) from public, anon;
grant execute on function public.live_event_results(uuid) to authenticated;
