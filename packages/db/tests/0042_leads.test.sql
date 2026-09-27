begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- ============================================================
-- Migration 0112 — leads (FUNIL T2.0) and live events (PAGINA-EVENTO.md).
--
-- The first public form that writes personal data of people with no account.
-- Every case below is one of three promises: nobody but the server writes and
-- nobody but the operator reads; a stranger typing someone else's number can
-- neither rewrite her data nor learn it; and "deleted" means gone, history
-- included.
-- ============================================================

-- ---------- Privileges ----------

select ok(not has_table_privilege('anon', 'public.leads', 'SELECT'), 'anon cannot read leads');
select ok(not has_table_privilege('anon', 'public.live_events', 'SELECT'),
  'anon cannot read events (they hold the Community invite and the stream)');
select ok(not has_table_privilege('anon', 'public.live_event_registrations', 'SELECT'), 'anon cannot read registrations');
select ok(not has_table_privilege('authenticated', 'public.live_event_tokens', 'SELECT'), 'no signed-in user reads tokens');
select ok(not has_table_privilege('authenticated', 'public.leads', 'DELETE'),
  'a lead cannot be deleted around purge_lead (which also clears the history)');
select ok(not has_table_privilege('authenticated', 'public.live_event_registrations', 'INSERT'),
  'registrations are only created by the server');
select ok(
  not has_function_privilege('anon', 'public.submit_live_event_registration(text, text, text, text, boolean, text, text, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.submit_live_event_registration(text, text, text, text, boolean, text, text, jsonb, jsonb)', 'EXECUTE'),
  'no client calls the registration directly (rate limit and honeypot live in front of it)'
);
select ok(
  has_function_privilege('service_role', 'public.submit_live_event_registration(text, text, text, text, boolean, text, text, jsonb, jsonb)', 'EXECUTE'),
  'the server registers'
);
select ok(
  not has_function_privilege('authenticated', 'public.touch_live_event_registration(text, text, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.touch_live_event_registration(text, text, integer)', 'EXECUTE'),
  'only the server marks group clicks and presence'
);
select ok(
  not has_function_privilege('authenticated', 'public.purge_expired_leads()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.purge_expired_leads()', 'EXECUTE'),
  'retention runs from the server job'
);
select ok(
  not has_function_privilege('authenticated', 'public.purge_leads_internal(uuid[])', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.purge_leads_internal(uuid[])', 'EXECUTE'),
  'the raw purge is reachable only through the two guarded entry points'
);

-- ---------- Structure ----------

select ok(exists(select 1 from public.consent_terms where slug = 'evento-contato' and version = 1 and is_active),
  'the event contact term is seeded');
select ok(exists(select 1 from public.consent_terms where slug = 'medchina-novidades' and version = 1 and is_active),
  'the optional news term is seeded');
select ok(
  not exists(select 1 from public.consent_terms where slug in ('evento-contato', 'medchina-novidades') and body ilike '%provisório%'),
  'both terms ship as definitive text'
);
select is((select state from public.live_events where slug = 'lei-15345'), 'rascunho',
  'the first event starts as a draft, with no invented date');

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'leads-operator@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()
);
update public.profiles set is_superadmin = true where id = 'f1000000-0000-4000-8000-000000000001';

insert into public.live_events (slug, title, state, starts_at)
values ('teste-leads', 'Evento de teste', 'rascunho', null);

create temporary table lead_results (name text primary key, payload jsonb);
grant select, insert on table lead_results to authenticated, service_role;

-- ---------- Registration ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into lead_results values ('draft', public.submit_live_event_registration(
  'teste-leads', 'Ana', '62999990001', null, false, null, repeat('a', 64), '{}', '{}'));

reset role;
update public.live_events set state = 'inscricoes', starts_at = now() + interval '7 days' where slug = 'teste-leads';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into lead_results values ('first', public.submit_live_event_registration(
  'teste-leads', ' Ana Lima ', '62999990001', 'ANA@EXEMPLO.COM', false,
  repeat('1', 64), repeat('a', 64),
  '{"origem":"instagram","utm_campaign":"lei-15345"}', '{"origem":"grupo","utm_medium":"whatsapp"}'));
-- Someone else types HER number with another name and e-mail, and ticks the news box.
insert into lead_results values ('repeat', public.submit_live_event_registration(
  'teste-leads', 'Impostora', '62999990001', 'outra@exemplo.com', true,
  repeat('2', 64), repeat('b', 64), '{}', '{}'));
insert into lead_results values ('bad-phone', public.submit_live_event_registration(
  'teste-leads', 'Bia', '6233334444', null, false, null, repeat('c', 64), '{}', '{}'));

reset role;

select is((select payload ->> 'code' from lead_results where name = 'draft'), 'not_open',
  'a draft event takes no registration');
select is((select payload ->> 'code' from lead_results where name = 'first'), 'created', 'the first registration is created');
select is((select payload ->> 'confirmation_email' from lead_results where name = 'first'), 'ana@exemplo.com',
  'a new registration returns the stored e-mail for the confirmation');
select is((select name from public.leads where phone = '62999990001'), 'Ana Lima', 'the name is stored trimmed');
select is((select origem from public.leads where phone = '62999990001'), 'instagram', 'the lead keeps the first touch');
select is(
  (select r.origem from public.live_event_registrations r join public.leads l on l.id = r.lead_id where l.phone = '62999990001'),
  'grupo', 'the registration keeps the channel that brought it');
select is((select payload ->> 'code' from lead_results where name = 'repeat'), 'existing',
  'typing an existing number shows the same confirmation');
select is((select name from public.leads where phone = '62999990001'), 'Ana Lima',
  'a repeat never rewrites the name');
select is((select email from public.leads where phone = '62999990001'), 'ana@exemplo.com',
  'a repeat never rewrites the e-mail');
select ok((select payload ->> 'confirmation_email' from lead_results where name = 'repeat') is null,
  'a repeat triggers no confirmation e-mail');
select is(
  (select count(*)::integer from public.live_event_tokens t
     join public.live_event_registrations r on r.id = t.registration_id
     join public.leads l on l.id = r.lead_id where l.phone = '62999990001'),
  2, 'each device gets its own token and the first one keeps working');
select ok((select marketing_accepted_at is not null from public.leads where phone = '62999990001'),
  'the optional consent can be added on a later registration');
select is((select payload ->> 'code' from lead_results where name = 'bad-phone'), 'invalid_phone',
  'a landline (no WhatsApp) is refused by the fence too');

-- ---------- Per-network window ----------

reset role;
update public.live_events set ip_window_limit = 1 where slug = 'teste-leads';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into lead_results values ('crowded', public.submit_live_event_registration(
  'teste-leads', 'Carla', '62999990002', null, false, repeat('1', 64), repeat('d', 64), '{}', '{}'));
reset role;

select is((select payload ->> 'code' from lead_results where name = 'crowded'), 'too_many',
  'a network over its hourly window is told to wait');
select ok(not exists(select 1 from public.leads where phone = '62999990002'),
  'and nothing is written for it');

-- ---------- Touch ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into lead_results values ('group', public.touch_live_event_registration(repeat('a', 64), 'group', 0));
insert into lead_results values ('early', public.touch_live_event_registration(repeat('a', 64), 'presence', 60));
reset role;

select ok(
  (select r.group_clicked_at is not null from public.live_event_registrations r
     join public.leads l on l.id = r.lead_id where l.phone = '62999990001'),
  'the group click is marked from the cookie token');
select ok(
  (select payload ->> 'code' from lead_results where name = 'early') = 'not_live'
  and not exists(select 1 from public.live_event_presence p
                   join public.live_event_registrations r on r.id = p.registration_id
                   join public.leads l on l.id = r.lead_id where l.phone = '62999990001'),
  'a heartbeat before the live is not presence');

update public.live_events set state = 'ao_vivo' where slug = 'teste-leads';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into lead_results values ('presence', public.touch_live_event_registration(repeat('a', 64), 'presence', 0));
insert into lead_results values ('presence2', public.touch_live_event_registration(repeat('b', 64), 'presence', 999));
insert into lead_results values ('unknown', public.touch_live_event_registration(repeat('e', 64), 'group', 0));
reset role;

select is(
  (select p.watched_seconds from public.live_event_presence p
     join public.live_event_registrations r on r.id = p.registration_id
     join public.leads l on l.id = r.lead_id where l.phone = '62999990001'),
  120, 'a heartbeat counts at most two minutes, whatever the client claims');
select is((select payload ->> 'code' from lead_results where name = 'unknown'), 'not_found',
  'an unknown token marks nothing');

-- ---------- Erasure ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
update public.live_events set duration_minutes = 75 where slug = 'teste-leads';
insert into lead_results values ('purge', public.purge_lead((select id from public.leads where phone = '62999990001'), 'pedido da titular por e-mail'));
reset role;

select is((select updated_by from public.live_events where slug = 'teste-leads'),
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'an edit to the event is stamped with the operator who made it');

select is((select payload ->> 'ok' from lead_results where name = 'purge'), 'true', 'the operator erases a lead');
select ok(not exists(select 1 from public.leads where phone = '62999990001'), 'the lead is gone');
select ok(
  exists(select 1 from public.audit_events where action = 'admin.leads.purged'
         and metadata ->> 'reason' = 'pedido da titular por e-mail'
         and metadata::text not like '%62999990001%'),
  'the erasure is audited with the operator''s reason and without the erased data'
);
select ok(
  not exists(select 1 from public.record_versions where table_name in ('leads', 'live_event_registrations')
             and data ->> 'phone' = '62999990001')
  and not exists(select 1 from public.record_versions where table_name = 'live_event_registrations'
             and data ->> 'origem' = 'grupo' and data ->> 'utm_medium' = 'whatsapp'),
  'and so is every version of it: the phone does not survive in the history');

-- ---------- Retention ----------

reset role;
update public.live_events set ip_window_limit = 100 where slug = 'teste-leads';
insert into public.live_events (slug, title, state, starts_at)
values ('teste-antigo', 'Evento antigo', 'encerrado', now() - interval '7 months');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into lead_results values ('old-plain', public.submit_live_event_registration(
  'teste-antigo', 'Dora', '62999990003', null, false, null, repeat('f', 64), '{}', '{}'));
insert into lead_results values ('old-news', public.submit_live_event_registration(
  'teste-antigo', 'Eva', '62999990004', null, true, null, repeat('9', 64), '{}', '{}'));
insert into lead_results values ('recent', public.submit_live_event_registration(
  'teste-leads', 'Fabi', '62999990005', null, false, null, repeat('8', 64), '{}', '{}'));
insert into lead_results values ('retention', public.purge_expired_leads());
reset role;

select ok(not exists(select 1 from public.leads where phone = '62999990003'),
  'six months after the last event, a lead without the news consent is erased');
select ok(exists(select 1 from public.leads where phone = '62999990004'),
  'a lead who opted into news stays until she withdraws');
select ok(exists(select 1 from public.leads where phone = '62999990005'),
  'a lead of a recent event stays');

select * from finish();
rollback;
