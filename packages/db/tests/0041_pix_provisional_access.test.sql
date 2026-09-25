begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ============================================================
-- Migration 0111 — Pro provisório enquanto o PIX é confirmado.
--
-- `org_audio_allowance` is the one answer the recorder gate, the trial start
-- and the whole UI share, so every case below is about someone being allowed,
-- or refused, for the RIGHT reason: a PIX she started lets her work while the
-- bank confirms; the window closes on time or on an overdue charge; and nobody
-- who came through a payment path is offered — or silently given — the trial.
-- ============================================================

-- ---------- Structure ----------

select ok(
  exists(select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'provisional_until'),
  'a pending PIX records until when it may stand in for the plan'
);
select ok(
  exists(select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'payment_method'),
  'a subscription records how it is being paid'
);
select ok(
  exists(select 1 from public.platform_settings where key = 'pix_provisional_access'),
  'the provisional window is configurable data, not a constant'
);
select ok(
  not has_function_privilege('authenticated', 'public.mark_pix_checkout(uuid, text)', 'EXECUTE'),
  'no client can open its own provisional window'
);
select ok(
  has_function_privilege('service_role', 'public.mark_pix_checkout(uuid, text)', 'EXECUTE'),
  'the server marks the PIX checkout right after creating the charge'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pix-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Pix Owner"}'::jsonb, now(), now()
);
insert into public.organizations (id, name, slug, created_by)
values ('c2000000-0000-4000-8000-000000000001', 'Pix practice', 'pix-practice',
        'c1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

-- The org trigger attached Gratuito, active — the situation every new account
-- is in, and exactly the one the old function misread.
create temporary table pix_results (name text primary key, payload jsonb);
grant select, insert on table pix_results to authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- A CARD checkout left incomplete: no method recorded, so nothing changes.
insert into public.subscriptions (org_id, plan_id, status, provider, provider_subscription_id, period)
values ('c2000000-0000-4000-8000-000000000001', (select id from public.plans where slug = 'assistente'),
        'incomplete', 'asaas', 'sub_card_1', 'monthly');
insert into pix_results values ('card', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

-- The PIX checkout for Pro, then the server marks it.
insert into public.subscriptions (org_id, plan_id, status, provider, provider_subscription_id, period)
values ('c2000000-0000-4000-8000-000000000001', (select id from public.plans where slug = 'pro'),
        'incomplete', 'asaas', 'sub_pix_1', 'monthly');
insert into pix_results values
  ('mark', public.mark_pix_checkout('c2000000-0000-4000-8000-000000000001', 'sub_pix_1'));
insert into pix_results values ('provisional', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

-- A second PIX (another plan) must not open another window: once per workspace.
insert into public.subscriptions (org_id, plan_id, status, provider, provider_subscription_id, period)
values ('c2000000-0000-4000-8000-000000000001', (select id from public.plans where slug = 'assistente'),
        'incomplete', 'asaas', 'sub_pix_2', 'monthly');
insert into pix_results values
  ('second-mark', public.mark_pix_checkout('c2000000-0000-4000-8000-000000000001', 'sub_pix_2'));
-- Park it so the rest of the file is about the first PIX.
update public.subscriptions set status = 'canceled' where provider_subscription_id = 'sub_pix_2';

-- The charge went overdue: the webhook records a failed invoice and leaves the
-- subscription incomplete.
insert into public.invoices (org_id, subscription_id, provider, provider_invoice_id, amount_cents, status)
values ('c2000000-0000-4000-8000-000000000001',
        (select id from public.subscriptions where provider_subscription_id = 'sub_pix_1'),
        'asaas', 'pay_pix_1', 29900, 'failed');
insert into pix_results values ('overdue', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

-- No failed invoice, but the window itself has passed.
delete from public.invoices where provider_invoice_id = 'pay_pix_1';
update public.subscriptions set provisional_until = now() - interval '1 minute'
where provider_subscription_id = 'sub_pix_1';
insert into pix_results values ('expired', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

-- Finally the bank confirms: Gratuito retires, the Pro row goes live.
update public.subscriptions set status = 'canceled'
where org_id = 'c2000000-0000-4000-8000-000000000001'
  and plan_id = (select id from public.plans where slug = 'gratuito');
update public.subscriptions set status = 'active', current_period_start = now(),
       current_period_end = now() + interval '1 month'
where provider_subscription_id = 'sub_pix_1';
insert into pix_results values ('confirmed', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

reset role;

-- ---------- A card checkout is untouched ----------

select is((select payload ->> 'provisional' from pix_results where name = 'card'), 'false',
  'an abandoned CARD checkout grants nothing');
select is((select payload ->> 'reason' from pix_results where name = 'card'), 'trial_not_started',
  'without a PIX, the trial offer stays exactly where it was');

-- ---------- Provisional window ----------

select ok((select (payload ->> 'provisional_until')::timestamptz between now() + interval '23 hours'
                  and now() + interval '25 hours' from pix_results where name = 'mark'),
  'marking the PIX opens the configured window (24h)');
select is((select payload ->> 'source' from pix_results where name = 'provisional'), 'plan',
  'while the bank confirms, the pending plan stands in for the plan');
select is((select payload ->> 'provisional' from pix_results where name = 'provisional'), 'true',
  'and says it is provisional, so the UI keeps "confirmando pagamento"');
select is((select payload ->> 'plan_slug' from pix_results where name = 'provisional'), 'pro',
  'it is the plan she is paying for, not the free one');
select is((select payload ->> 'can_start' from pix_results where name = 'provisional'), 'true',
  'she can record now, to finish the onboarding');
select is((select payload ->> 'clinical_reasoning' from pix_results where name = 'provisional'), 'true',
  'and has the Pro reasoning the plan includes');
select is((select payload ->> 'trial_available' from pix_results where name = 'provisional'), 'false',
  'no trial is offered to someone paying — nor started automatically');
select is((select payload ->> 'pack_purchasable' from pix_results where name = 'provisional'), 'false',
  'no minute pack sold on top of a charge that has not been paid');

-- ---------- Once per workspace ----------

select is((select payload ->> 'provisional_until' from pix_results where name = 'second-mark'), null,
  'a second PIX never opens a second window');

-- ---------- The window closes ----------

select is((select payload ->> 'provisional' from pix_results where name = 'overdue'), 'false',
  'an overdue charge closes the window before its time');
select is((select payload ->> 'can_start' from pix_results where name = 'overdue'), 'false',
  'and recording stops');
select is((select payload ->> 'reason' from pix_results where name = 'overdue'), 'payment_unconfirmed',
  'naming the cause: the payment was not confirmed');
select is((select payload ->> 'reason' from pix_results where name = 'expired'), 'payment_unconfirmed',
  'the same when the window simply runs out');
select is((select payload ->> 'trial_available' from pix_results where name = 'expired'), 'false',
  'and even then no trial — she came through a payment path');
select is((select payload ->> 'source' from pix_results where name = 'expired'), 'none',
  'Pro is disabled: back to what the free plan allows');

-- ---------- Confirmed ----------

select is((select payload ->> 'provisional' from pix_results where name = 'confirmed'), 'false',
  'once confirmed it is simply the plan');
select is((select payload ->> 'reason' from pix_results where name = 'confirmed'), 'ok',
  'with nothing left to resolve');
select is((select payload ->> 'payment_pending' from pix_results where name = 'confirmed'), 'false',
  'and no pending payment reported');

select * from finish();
rollback;
