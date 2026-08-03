begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ---------- Contract ----------

select ok(to_regclass('public.library_usage') is not null, 'the library meter is a table of its own');
select ok((select relrowsecurity from pg_class where oid = 'public.library_usage'::regclass), 'meter RLS is enabled');
-- What actually stops a client write is RLS with no write policy (the shape
-- audio_usage uses); the revoked grants are the second lock.
select ok(
  not exists(
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'library_usage' and cmd <> 'SELECT'
  ),
  'no policy lets a client insert, update or delete the meter'
);
select ok(
  not has_table_privilege('authenticated', 'public.library_usage', 'INSERT')
  and not has_table_privilege('authenticated', 'public.library_usage', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.library_usage', 'DELETE'),
  'and the write grants Supabase adds by default are revoked too'
);
select ok(
  has_table_privilege('authenticated', 'public.library_usage', 'SELECT'),
  'but the workspace can read its own consumption'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_library_usage(uuid,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_library_usage(uuid,text,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_library_usage(uuid,text,uuid,uuid)', 'EXECUTE'),
  'recording usage is a service-role act, not a client one'
);
select ok(
  (select confdeltype = 'n'
   from pg_constraint
   where conrelid = 'public.library_usage'::regclass
     and confrelid = 'public.conversations'::regclass),
  'deleting a conversation nulls the reference instead of deleting the meter row'
);
select ok(
  coalesce((select position('library_usage' in prosrc) > 0
            from pg_proc where oid = 'public.org_message_allowance(uuid,text)'::regprocedure), false),
  'the allowance counts the ledger, not deletable messages'
);
select ok(
  coalesce((select position('past_due_blocked' in prosrc) > 0
            from pg_proc where oid = 'public.org_message_allowance(uuid,text)'::regprocedure), false),
  'and the dunning window with its named reason (0054) is preserved'
);

-- ---------- Behavior: the meter survives what the content does not ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'library-meter-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"Library meter pgTAP"}'::jsonb, now(), now()
);
delete from public.memberships where user_id = 'c1000000-0000-4000-8000-000000000001';
insert into public.organizations (id, name, slug, created_by)
values ('c2000000-0000-4000-8000-000000000001', 'Prática biblioteca', 'library-meter-pgtap', 'c1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner');

insert into public.conversations (id, org_id, assistant_id, created_by, title)
select
  'c3000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  a.id,
  'c1000000-0000-4000-8000-000000000001',
  'Conversa de estudo'
from public.assistants a where a.slug = 'biblioteca-mtc';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.record_library_usage(
  'c2000000-0000-4000-8000-000000000001', 'biblioteca-mtc', 'c3000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001'
);
select public.record_library_usage(
  'c2000000-0000-4000-8000-000000000001', 'biblioteca-mtc', 'c3000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (select count(*)::int from public.library_usage where org_id = 'c2000000-0000-4000-8000-000000000001'),
  2,
  'two answered messages are two ledger entries'
);

-- The whole point: erasing the clinical content must not refund the quota.
delete from public.conversations where id = 'c3000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.library_usage where org_id = 'c2000000-0000-4000-8000-000000000001'),
  2,
  'deleting the conversation does not reset the month''s consumption'
);
select ok(
  (select bool_and(conversation_id is null) from public.library_usage
   where org_id = 'c2000000-0000-4000-8000-000000000001'),
  'and the link to the erased conversation is dropped, not the meter'
);

select * from finish();
rollback;
