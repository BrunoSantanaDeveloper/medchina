begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- ============================================================
-- Migration 0113 — many live events: page content as data, per-event results,
-- and the lifecycle rules the console relies on.
--
-- Five promises: a new event never touches another's data; the address of an
-- event that was ever published cannot move and the event cannot be deleted;
-- a form post for a second event cannot undo what the team or the person
-- decided about her; and the results (visits, device of the group click,
-- purchases) are counted without a single personal datum and read only by the
-- operator.
-- ============================================================

-- ---------- Privileges ----------

select ok(not has_table_privilege('anon', 'public.live_event_page_views', 'SELECT'), 'anon cannot read page views');
select ok(not has_table_privilege('anon', 'public.purchase_attributions', 'SELECT'), 'anon cannot read purchase attributions');
select ok(not has_table_privilege('authenticated', 'public.purchase_attributions', 'INSERT'),
  'no signed-in user writes a purchase attribution (the webhook does)');
select ok(not has_table_privilege('authenticated', 'public.live_event_page_views', 'INSERT'),
  'no signed-in user writes page views (the page render does, as the server)');
select ok(
  not has_table_privilege('anon', 'public.live_event_device_clicks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.live_event_device_clicks', 'INSERT'),
  'the device counters are neither public nor writable by a signed-in user'
);
select ok(
  not has_function_privilege('authenticated', 'public.count_live_event_view(text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.count_live_event_view(text, text)', 'EXECUTE'),
  'only the server counts a visit'
);
select ok(
  not has_function_privilege('anon', 'public.delete_live_event(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.duplicate_live_event(uuid, text, text)', 'EXECUTE'),
  'anon cannot delete or duplicate events'
);
select ok(
  not has_function_privilege('authenticated', 'public.touch_live_event_registration(text, text, integer, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.touch_live_event_registration(text, text, integer, text)', 'EXECUTE'),
  'the touch function keeps its server-only grant after the new signature'
);
select hasnt_column('public', 'live_event_registrations', 'group_clicked_device',
  'the device is never stored on the person (her contact term does not list it)');

-- ---------- The first event keeps its page ----------

select ok(
  (select topic = 'a Lei 15.345' and jsonb_array_length(topics) = 3 and headline like '%**e o que eu vi na China.**'
     and byline = 'com Debora Giovanella, fundadora do MedChina'
     and page_title = 'Ao vivo: o que muda depois da Lei 15.345' and offer_angle = 'china'
   from public.live_events where slug = 'lei-15345'),
  'the Lei 15.345 page content, tab title and offer angle moved from code to its row, unchanged'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'events-operator@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()),
  ('f2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'events-someone@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Someone"}'::jsonb, now(), now());
update public.profiles set is_superadmin = true where id = 'f2000000-0000-4000-8000-000000000001';

insert into public.live_events (id, slug, title, state, starts_at, topic, headline)
values
  ('e1000000-0000-4000-8000-000000000001', 'teste-rascunho', 'Rascunho', 'rascunho', null, 'um teste', 'Manchete **teste.**'),
  ('e1000000-0000-4000-8000-000000000002', 'teste-publicado', 'Publicado', 'inscricoes', now() + interval '7 days', null, null),
  ('e1000000-0000-4000-8000-000000000003', 'teste-vazio', 'Vazio', 'rascunho', null, null, null),
  ('e1000000-0000-4000-8000-000000000004', 'teste-canais', 'Canais', 'inscricoes', now() + interval '9 days', null, null),
  ('e1000000-0000-4000-8000-000000000005', 'teste-recolhido', 'Recolhido', 'inscricoes', now() + interval '9 days', null, null);

insert into public.leads (id, name, phone) values ('d1000000-0000-4000-8000-000000000001', 'Ana', '62999991001');
insert into public.live_event_registrations (id, event_id, lead_id, contact_term_id, contact_term_version, contact_term_text, origem)
select 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001',
       t.id, t.version, t.body, 'instagram'
from public.consent_terms t where t.slug = 'evento-contato' order by t.version desc limit 1;
insert into public.live_event_registrations (id, event_id, lead_id, contact_term_id, contact_term_version, contact_term_text)
select 'c1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
       t.id, t.version, t.body
from public.consent_terms t where t.slug = 'evento-contato' order by t.version desc limit 1;
insert into public.live_event_tokens (token_hash, registration_id, expires_at)
values (repeat('7', 64), 'c1000000-0000-4000-8000-000000000001', now() + interval '30 days');

select ok(
  (select count(*) = 2 from public.live_event_registrations where lead_id = 'd1000000-0000-4000-8000-000000000001'),
  'one person, two events: each registration stays with its own event'
);

-- ---------- Content shape ----------

select throws_ok(
  $$update public.live_events set topics = '[{"icon":"lei","text":"a"},{"icon":"lei","text":"b"},{"icon":"lei","text":"c"},{"icon":"lei","text":"d"}]'::jsonb
    where slug = 'teste-vazio'$$,
  '23514', null, 'at most three topics');
select throws_ok(
  $$update public.live_events set topics = '[{"icon":"nope","text":"a"}]'::jsonb where slug = 'teste-vazio'$$,
  '23514', null, 'a topic icon comes from the fixed set');
select throws_ok(
  $$update public.live_events set topics = '{"icon":"lei"}'::jsonb where slug = 'teste-vazio'$$,
  '23514', null, 'topics must be an array — refused, not an internal error');
select throws_ok(
  $$update public.live_events set offer_angle = 'China!' where slug = 'teste-vazio'$$,
  '23514', null, 'the offer angle is one lower-case word (it leads utm_content)');
select throws_ok(
  $$update public.live_events set ended_behavior = 'redirect' where slug = 'teste-vazio'$$,
  '23514', null, 'a redirect needs a destination');
select throws_ok(
  $$update public.live_events set ended_behavior = 'redirect', ended_redirect_path = '//evil.example' where slug = 'teste-vazio'$$,
  '23514', null, 'a protocol-relative destination is refused (no open redirect)');
select throws_ok(
  $$update public.live_events set ended_behavior = 'redirect', ended_redirect_path = 'https://evil.example' where slug = 'teste-vazio'$$,
  '23514', null, 'an absolute URL is refused');
select lives_ok(
  $$update public.live_events set ended_behavior = 'redirect', ended_redirect_path = '/china' where slug = 'teste-vazio'$$,
  'an address of this site is accepted');
select throws_ok(
  $$update public.live_events set archived_at = now() where slug = 'teste-publicado'$$,
  '23514', null, 'an event with open registrations cannot be archived');

-- ---------- Publication and the address ----------

select ok(
  (select published_at is not null from public.live_events where slug = 'teste-publicado')
  and (select published_at is null from public.live_events where slug = 'teste-vazio'),
  'publishing stamps published_at; a draft has none'
);

update public.live_events set state = 'rascunho' where slug = 'teste-recolhido';
update public.live_events set published_at = null where slug = 'teste-recolhido';
select ok(
  (select published_at is not null from public.live_events where slug = 'teste-recolhido'),
  'moving an event back to draft does not unpublish it, and published_at cannot be cleared'
);

select lives_ok(
  $$update public.live_events set slug = 'teste-vazio-2' where slug = 'teste-vazio'$$,
  'a draft never published and nobody registered for can still change its address');
select throws_ok(
  $$update public.live_events set slug = 'teste-publicado-2' where slug = 'teste-publicado'$$,
  '23514', 'live_event_slug_locked', 'a published event keeps its address');
select throws_ok(
  $$update public.live_events set slug = 'teste-rascunho-2' where slug = 'teste-rascunho'$$,
  '23514', 'live_event_slug_locked', 'so does a draft someone already registered for');
select throws_ok(
  $$update public.live_events set slug = 'teste-recolhido-2' where slug = 'teste-recolhido'$$,
  '23514', 'live_event_slug_locked', 'and a draft that was once published — its address is already out there');

-- ---------- Duplicate and delete ----------

create temporary table crud_results (name text primary key, payload jsonb);
grant select, insert on table crud_results to authenticated, service_role;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into crud_results values ('dup-stranger', public.duplicate_live_event('e1000000-0000-4000-8000-000000000001', 'copia-estranha', 'Cópia'));
insert into crud_results values ('del-stranger', public.delete_live_event('e1000000-0000-4000-8000-000000000003', 'teste'));
insert into crud_results values ('results-stranger', public.live_event_results('e1000000-0000-4000-8000-000000000002'));
insert into crud_results values ('overview-stranger', jsonb_build_object('rows', (select count(*) from public.live_events_overview())));
reset role;

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into crud_results values ('dup', public.duplicate_live_event('e1000000-0000-4000-8000-000000000001', 'teste-copia', 'Cópia do rascunho'));
insert into crud_results values ('dup-taken', public.duplicate_live_event('e1000000-0000-4000-8000-000000000001', 'teste-publicado', 'Outra'));
insert into crud_results values ('del-published', public.delete_live_event('e1000000-0000-4000-8000-000000000002', 'teste'));
insert into crud_results values ('del-registered', public.delete_live_event('e1000000-0000-4000-8000-000000000001', 'teste'));
insert into crud_results values ('del-was-published', public.delete_live_event('e1000000-0000-4000-8000-000000000005', 'teste'));
insert into crud_results values ('del-empty', public.delete_live_event('e1000000-0000-4000-8000-000000000003', 'criado por engano'));
reset role;

select is((select payload ->> 'code' from crud_results where name = 'dup-stranger'), 'not_authorized',
  'only the operator duplicates');
select is((select payload ->> 'code' from crud_results where name = 'del-stranger'), 'not_authorized',
  'only the operator deletes');
select ok(
  (select e.state = 'rascunho' and e.topic = 'um teste' and e.headline = 'Manchete **teste.**' and e.published_at is null
     and not exists (select 1 from public.live_event_registrations r where r.event_id = e.id)
   from public.live_events e where e.slug = 'teste-copia'),
  'a duplicate copies the content, starts as an unpublished draft and has no registrations');
select is((select payload ->> 'code' from crud_results where name = 'dup-taken'), 'slug_taken',
  'a duplicate cannot take an address in use');
select is((select payload ->> 'code' from crud_results where name = 'del-published'), 'not_draft',
  'a published event is archived, never deleted');
select is((select payload ->> 'code' from crud_results where name = 'del-registered'), 'has_registrations',
  'a draft with a registration is not deleted either');
select is((select payload ->> 'code' from crud_results where name = 'del-was-published'), 'was_published',
  'nor is a draft that was once published');
select ok(
  (select payload ->> 'ok' = 'true' from crud_results where name = 'del-empty')
  and not exists (select 1 from public.live_events where id = 'e1000000-0000-4000-8000-000000000003')
  and exists (select 1 from public.audit_events where action = 'admin.events.deleted'
              and entity_id = 'e1000000-0000-4000-8000-000000000003' and metadata ->> 'reason' = 'criado por engano'),
  'an empty draft is deleted, with the reason in the audit trail');

-- ---------- Visits, device, purchases ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.count_live_event_view('teste-publicado', 'instagram');
select public.count_live_event_view('teste-publicado', 'Instagram!');
select public.count_live_event_view('teste-publicado', null);
select public.count_live_event_view('teste-rascunho', 'instagram');
-- 30 channels a day at most: 30 invented ones on top of "instagram", then the known one again.
select public.count_live_event_view('teste-canais', 'instagram');
do $$ begin for n in 1..40 loop perform public.count_live_event_view('teste-canais', 'canal-' || n); end loop; end $$;
select public.count_live_event_view('teste-canais', 'instagram');
insert into crud_results values ('touch-device', public.touch_live_event_registration(repeat('7', 64), 'group', 0, 'phone'));
insert into crud_results values ('touch-device-again', public.touch_live_event_registration(repeat('7', 64), 'group', 0, 'phone'));
insert into crud_results values ('touch-bad-device', public.touch_live_event_registration(repeat('7', 64), 'group', 0, 'tablet'));
insert into crud_results values ('touch-presence', public.touch_live_event_registration(repeat('7', 64), 'presence', 60, null));
reset role;

select is(
  (select views from public.live_event_page_views
   where event_id = 'e1000000-0000-4000-8000-000000000002' and origem = 'instagram'),
  2, 'visits are counted per event, per day, per channel — one spelling per channel');
select is(
  (select views from public.live_event_page_views
   where event_id = 'e1000000-0000-4000-8000-000000000002' and origem = 'direto'),
  1, 'a visit without a channel counts as "direto"');
select ok(
  not exists (select 1 from public.live_event_page_views where event_id = 'e1000000-0000-4000-8000-000000000001'),
  'a draft counts no visits');
select ok(
  (select count(*) = 31 from public.live_event_page_views where event_id = 'e1000000-0000-4000-8000-000000000004')
  and (select views = 11 from public.live_event_page_views
       where event_id = 'e1000000-0000-4000-8000-000000000004' and origem = 'outro')
  and (select views = 2 from public.live_event_page_views
       where event_id = 'e1000000-0000-4000-8000-000000000004' and origem = 'instagram'),
  'past 30 channels a day, a new one is counted as "outro" — a known one keeps counting');
select is(
  (select clicks from public.live_event_device_clicks
   where event_id = 'e1000000-0000-4000-8000-000000000002' and device = 'phone'),
  1, 'the group click is counted per event and device, once per registration');
select is((select payload ->> 'code' from crud_results where name = 'touch-bad-device'), 'invalid_request',
  'an unknown device class is refused');
select is((select payload ->> 'code' from crud_results where name = 'touch-presence'), 'not_live',
  'presence is only recorded while the event is on air');

insert into public.organizations (id, name, slug) values ('b1000000-0000-4000-8000-000000000001', 'Consultório', 'crud-teste-org');
insert into public.invoices (org_id, provider, provider_invoice_id, amount_cents, status, paid_at)
values ('b1000000-0000-4000-8000-000000000001', 'asaas', 'inv_1', 199000, 'paid', now()),
       ('b1000000-0000-4000-8000-000000000001', 'asaas', 'inv_2', 29900, 'refunded', now());
insert into public.purchase_attributions (org_id, invoice_key, amount_cents, currency, paid_at, utm_campaign)
values ('b1000000-0000-4000-8000-000000000001', 'asaas:inv_1', 199000, 'BRL', now(), 'teste-publicado'),
       ('b1000000-0000-4000-8000-000000000001', 'asaas:inv_2', 29900, 'BRL', now(), 'teste-publicado');

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into crud_results values ('results', public.live_event_results('e1000000-0000-4000-8000-000000000002'));
insert into crud_results values ('overview', jsonb_build_object('rows', (select count(*) from public.live_events_overview())));
insert into crud_results values ('overview-purchases', jsonb_build_object('purchases',
  (select purchases from public.live_events_overview() where slug = 'teste-publicado')));
reset role;

select ok(
  (select (payload ->> 'registrations')::int = 1 and (payload ->> 'visits')::int = 3
     and (payload ->> 'group_phone')::int = 1 and (payload ->> 'group_computer')::int = 0
     and payload -> 'channels' @> '[{"channel":"instagram","visits":2,"registrations":1}]'::jsonb
     and payload -> 'channels' @> '[{"channel":"direto","visits":1,"registrations":0}]'::jsonb
   from crud_results where name = 'results'),
  'the results join visits and registrations by channel, and read the device counters');
select ok(
  (select (payload ->> 'purchases')::int = 1 and (payload ->> 'revenue_cents')::int = 199000
   from crud_results where name = 'results')
  and (select (payload ->> 'purchases')::int = 1 from crud_results where name = 'overview-purchases'),
  'the purchases of a campaign are the event''s purchases — only while the invoice stays paid');
select is((select payload ->> 'code' from crud_results where name = 'results-stranger'), 'not_authorized',
  'results are the operator''s only');
select ok(
  (select (payload ->> 'rows')::int = 0 from crud_results where name = 'overview-stranger')
  and (select (payload ->> 'rows')::int >= 3 from crud_results where name = 'overview'),
  'the overview lists events for the operator and nothing for anyone else');

-- ---------- A second event's form cannot undo a decision ----------

-- Bia left (the team recorded it) and had revoked the news consent before.
insert into public.leads (
  id, name, phone, email, opted_out_at,
  marketing_term_id, marketing_term_version, marketing_term_text, marketing_accepted_at, marketing_revoked_at
)
select 'd1000000-0000-4000-8000-000000000002', 'Bia', '62999991002', 'bia@exemplo.invalid', now() - interval '1 day',
       t.id, t.version, t.body, now() - interval '30 days', now() - interval '2 days'
from public.consent_terms t where t.slug = 'medchina-novidades' order by t.version desc limit 1;
-- Caio exists with an e-mail and never gave the news consent.
insert into public.leads (id, name, phone, email)
values ('d1000000-0000-4000-8000-000000000003', 'Caio', '62999991003', 'caio@exemplo.invalid');
update public.live_events set ip_window_limit = 1
 where id in ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000004');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into crud_results values ('bia', public.submit_live_event_registration(
  'teste-publicado', 'Bia Outra', '62999991002', 'bia@exemplo.invalid', true, null, repeat('1', 64), '{}'::jsonb, '{}'::jsonb));
insert into crud_results values ('caio-wrong-email', public.submit_live_event_registration(
  'teste-publicado', 'Caio', '62999991003', 'outro@exemplo.invalid', true, repeat('a', 64), repeat('2', 64), '{}'::jsonb, '{}'::jsonb));
insert into crud_results values ('caio-own-email', public.submit_live_event_registration(
  'teste-canais', 'Caio', '62999991003', 'CAIO@exemplo.invalid', false, repeat('a', 64), repeat('3', 64), '{}'::jsonb, '{}'::jsonb));
insert into crud_results values ('duda-same-network', public.submit_live_event_registration(
  'teste-canais', 'Duda', '62999991004', 'duda@exemplo.invalid', false, repeat('a', 64), repeat('4', 64), '{}'::jsonb, '{}'::jsonb));
insert into crud_results values ('duda', public.submit_live_event_registration(
  'teste-canais', 'Duda', '62999991004', 'duda@exemplo.invalid', false, null, repeat('5', 64), '{}'::jsonb, '{}'::jsonb));
reset role;

select ok(
  (select payload ->> 'code' = 'created' and payload -> 'confirmation_email' = 'null'::jsonb
     from crud_results where name = 'bia')
  and (select opted_out_at is not null and marketing_revoked_at is not null and name = 'Bia'
         and marketing_accepted_at < now() - interval '29 days'
       from public.leads where id = 'd1000000-0000-4000-8000-000000000002'),
  'a person who left can register again, but the form lifts no opt-out, re-grants no revoked consent and sends her nothing');
select ok(
  (select payload ->> 'code' = 'created' and payload -> 'confirmation_email' = 'null'::jsonb
     from crud_results where name = 'caio-wrong-email')
  and (select email = 'caio@exemplo.invalid' and marketing_accepted_at is not null
       from public.leads where id = 'd1000000-0000-4000-8000-000000000003'),
  'an existing person typed with another address gets no e-mail (the stored one stays) — a first news consent is added');
select is((select payload ->> 'confirmation_email' from crud_results where name = 'caio-own-email'),
  'caio@exemplo.invalid',
  'typing the stored address proves it is her: the confirmation goes out');
select is((select payload ->> 'code' from crud_results where name = 'duda-same-network'), 'too_many',
  'the per-network window counts this event''s registrations — the other event''s did not fill it');
select ok(
  (select payload ->> 'code' = 'created' and (payload ->> 'lead_created')::boolean
     and payload ->> 'confirmation_email' = 'duda@exemplo.invalid'
   from crud_results where name = 'duda'),
  'a new person gets the confirmation at the address she just typed');

select * from finish();
rollback;
