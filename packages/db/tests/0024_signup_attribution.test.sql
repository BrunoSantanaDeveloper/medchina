begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- Migration 0086 — first-touch campaign attribution.
--
-- The measurement this table exists for cannot be reconstructed: if the first
-- wave goes out before the row is being written, "which channel produced paying
-- customers" is unanswerable forever. So the properties pinned here are the
-- ones that make the number trustworthy — it is written once and never
-- rewritten, the professional cannot see or touch it, and deleting a workspace
-- takes it along (LGPD erasure).
-- ============================================================

select has_column('public', 'signup_attribution', 'onda', 'the wave a signup came from is stored');
select has_column('public', 'signup_attribution', 'origem', 'and the channel');

-- ---------- Fixtures: an operator, a professional, a workspace ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'operator.attrib@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'pro.attrib@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Professional"}'::jsonb, now(), now()
  );

update public.profiles set is_superadmin = true where id = 'a1000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by)
values ('a2000000-0000-4000-8000-000000000001', 'Wave one practice', 'wave-one-practice',
        'a1000000-0000-4000-8000-000000000002');

insert into public.memberships (org_id, user_id, role)
values ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'owner')
on conflict do nothing;

-- ---------- First touch wins ----------

insert into public.signup_attribution (org_id, origem, onda, landing_path)
values ('a2000000-0000-4000-8000-000000000001', 'whatsapp', '1', '/voltar');

-- The app inserts with ON CONFLICT DO NOTHING from more than one entry point
-- (e-mail confirmation and the OAuth complete-profile step). A second campaign
-- must not take credit for a signup the first one produced.
insert into public.signup_attribution (org_id, origem, onda, landing_path)
values ('a2000000-0000-4000-8000-000000000001', 'instagram', '2', '/fundadores')
on conflict (org_id) do nothing;

select is(
  (select onda from public.signup_attribution where org_id = 'a2000000-0000-4000-8000-000000000001'),
  '1',
  'a later touch does not overwrite the wave that actually brought her'
);
select is(
  (select origem from public.signup_attribution where org_id = 'a2000000-0000-4000-8000-000000000001'),
  'whatsapp',
  'nor the channel'
);

-- ---------- A campaign name cannot be a payload ----------

select throws_ok(
  $$insert into public.signup_attribution (org_id, onda)
    values ('a2000000-0000-4000-8000-000000000099', repeat('x', 65))$$,
  '23514',
  -- `throws_ok(sql, errcode, errmsg, description)`: with three arguments the
  -- last one is read as the expected MESSAGE, so this compared the constraint's
  -- real text against a sentence written for a human. The description belongs
  -- in the fourth slot, with the message left unchecked.
  null,
  'an oversized value from a query string is refused by the database, not only by the app'
);

-- ---------- It belongs to the operator, not to the professional ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.signup_attribution),
  0,
  'the professional cannot read how she was acquired — it is platform data, not hers'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.signup_attribution),
  1,
  'the operator can, which is who the funnel report is for'
);
reset role;

-- ---------- Erasure takes it along ----------

delete from public.organizations where id = 'a2000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.signup_attribution
   where org_id = 'a2000000-0000-4000-8000-000000000001'),
  0,
  'deleting a workspace deletes its attribution — no orphan marketing record survives erasure'
);

select * from finish();
rollback;
