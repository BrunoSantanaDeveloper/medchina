begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ============================================================
-- Migração 0119 — modalidades além das cinco do produto.
--
-- O que este teste protege: o texto livre fica na SUA coluna e nunca alarga a
-- lista fechada (que tem efeito clínico), não entra na auditoria por extenso,
-- não aceita o que um export de planilha leria como fórmula — nem pela RPC,
-- nem escrevendo a linha direto — e o passo "Como você atende" grava tudo numa
-- transação sem mover o carimbo do fuso já confirmado.
-- ============================================================

-- ---------- Contract ----------

select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'practice_modalities_other'
  ),
  'profiles keep the modalities she typed in their own column'
);
select ok(
  has_function_privilege('authenticated', 'public.update_practice_modalities_other(text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_practice_modalities_other(text[])', 'EXECUTE'),
  'only a signed-in professional may edit her own free-text modalities'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.complete_practice_scope(uuid,text,text[],text[],text[],text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.complete_practice_scope(uuid,text,text[],text[],text[],text)', 'EXECUTE'
  ),
  'the preparation step is reachable by a signed-in session only'
);
select ok(
  coalesce((select position('is_impersonated' in prosrc) > 0
            from pg_proc where oid = 'public.update_practice_modalities_other(text[])'::regprocedure), false)
  and coalesce((select position('is_impersonated' in prosrc) > 0
                from pg_proc
                where oid = 'public.complete_practice_scope(uuid,text,text[],text[],text[],text)'::regprocedure), false),
  'support impersonation is refused on both writes — profiles has no fence of its own (0057)'
);
select ok(
  has_function_privilege('anon', 'public.practice_modalities_other_valid(text[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.practice_modalities_other_valid(text[])', 'EXECUTE'),
  'the CHECK predicate is callable by every writer of the row, so no profile write dies on a privilege'
);

-- ---------- The normaliser and the validator, on their own ----------

select is(
  public.normalize_practice_modalities_other(
    array['  Tui   Na ', 'tui na', 'ACUPUNCTURE', '', null, E'Shiatsu\n', 'Shiatsu']::text[]
  ),
  array['Tui Na', 'Shiatsu']::text[],
  'trimmed, inner whitespace collapsed, empties and the five slugs dropped, first spelling of a repeat kept in typed order'
);
select ok(
  not public.practice_modalities_other_valid(array['=HYPERLINK("x")']::text[])
  and not public.practice_modalities_other_valid(array['+55 11']::text[])
  and not public.practice_modalities_other_valid(array['@tuina']::text[])
  and not public.practice_modalities_other_valid(array['-shiatsu']::text[]),
  'a label that a spreadsheet would read as a formula is refused'
);
select ok(
  not public.practice_modalities_other_valid(array[repeat('a', 61)]::text[])
  and not public.practice_modalities_other_valid(array['x']::text[])
  and public.practice_modalities_other_valid(array[repeat('a', 60)]::text[]),
  'a label is 2 to 60 characters — a name, not a paragraph'
);
select ok(
  not public.practice_modalities_other_valid(
    array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'b1', 'b2']::text[]
  )
  and not public.practice_modalities_other_valid(array['Tui Na', 'tui na']::text[])
  and public.practice_modalities_other_valid('{}'::text[]),
  'at most ten, no case-insensitive repeats, and declaring none is valid'
);

-- ---------- Fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e9000000-0000-4000-8000-000000000111', 'authenticated', 'authenticated',
    'other-owner@medchina.invalid', '', now(), '{}'::jsonb,
    '{"display_name":"Other pgTAP"}'::jsonb, now(), now()
  ),
  (
    'e9000000-0000-4000-8000-000000000112', 'authenticated', 'authenticated',
    'other-outsider@medchina.invalid', '', now(), '{}'::jsonb,
    '{"display_name":"Outsider pgTAP"}'::jsonb, now(), now()
  );
delete from public.memberships
where user_id in ('e9000000-0000-4000-8000-000000000111', 'e9000000-0000-4000-8000-000000000112');
insert into public.organizations (id, name, slug, created_by)
values ('e9100000-0000-4000-8000-000000000111', 'Prática outras', 'other-pgtap', 'e9000000-0000-4000-8000-000000000111');
insert into public.memberships (org_id, user_id, role)
values ('e9100000-0000-4000-8000-000000000111', 'e9000000-0000-4000-8000-000000000111', 'owner');

-- The closed list starts with a value, to prove the free text never touches it.
update public.profiles
set practice_modalities = array['acupuncture']::text[]
where id = 'e9000000-0000-4000-8000-000000000111';

create temporary table other_results (name text primary key, payload jsonb);
grant select, insert on table other_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"e9000000-0000-4000-8000-000000000111","role":"authenticated"}',
  true
);

-- ---------- Editing from /settings ----------

set local role authenticated;
insert into other_results values (
  'save',
  public.update_practice_modalities_other(array[' Tui   Na', 'tui na', 'Shiatsu', 'cupping']::text[])
);
reset role;

select is((select payload ->> 'code' from other_results where name = 'save'), 'updated', 'the free-text modalities are saved');
select is(
  (select practice_modalities_other from public.profiles where id = 'e9000000-0000-4000-8000-000000000111'),
  array['Tui Na', 'Shiatsu']::text[],
  'stored as she wrote them, normalised, with the product slug left out'
);
select is(
  (select practice_modalities from public.profiles where id = 'e9000000-0000-4000-8000-000000000111'),
  array['acupuncture']::text[],
  'the closed list — the one with clinical effect — is not widened by what she typed'
);
select ok(
  exists(select 1 from public.audit_events
         where action = 'practice.modalities_other.updated'
           and actor_id = 'e9000000-0000-4000-8000-000000000111'
           and (metadata ->> 'otherCount')::int = 2),
  'the change lands in the audit trail, as a count'
);
select ok(
  not exists(select 1 from public.audit_events
             where actor_id = 'e9000000-0000-4000-8000-000000000111'
               and metadata::text ilike '%tui%'),
  'and never as the list itself (same privacy discipline as 0050)'
);

set local role authenticated;
insert into other_results values ('invalid', public.update_practice_modalities_other(array['x']::text[]));
reset role;
select is(
  (select payload ->> 'code' from other_results where name = 'invalid'),
  'invalid_modality_other',
  'a label outside the rules is refused by name, and nothing is written'
);

-- The row is writable by its owner through PostgREST: the RPC is not the only
-- door, so the CHECK has to hold on its own.
set local role authenticated;
select throws_ok(
  $$update public.profiles
       set practice_modalities_other = array['=HYPERLINK("x")']::text[]
     where id = 'e9000000-0000-4000-8000-000000000111'$$,
  '23514',
  null,
  'writing the column around the RPC is refused by the row guard'
);
reset role;

-- ---------- The preparation step ----------

set local role authenticated;
insert into other_results values (
  'scope',
  public.complete_practice_scope(
    'e9100000-0000-4000-8000-000000000111',
    'America/Recife',
    array['Cupping', 'acupuncture', 'acupuncture']::text[],
    array['Tui Na']::text[],
    array['fertility']::text[],
    'browser'
  )
);
reset role;

select is((select payload ->> 'code' from other_results where name = 'scope'), 'completed', 'the step saves in one call');
select is(
  (select row(practice_modalities, practice_modalities_other, practice_areas)::text
   from public.profiles where id = 'e9000000-0000-4000-8000-000000000111'),
  row(array['acupuncture', 'cupping']::text[], array['Tui Na']::text[], array['fertility']::text[])::text,
  'modalities, free-text modalities and areas are written together'
);
select ok(
  (select timezone = 'America/Recife' and timezone_confirmed_at is not null
   from public.organizations where id = 'e9100000-0000-4000-8000-000000000111'),
  'the timezone is adopted and confirmed without a field of its own'
);
select ok(
  exists(select 1 from public.audit_events
         where action = 'practice.scope.completed'
           and actor_id = 'e9000000-0000-4000-8000-000000000111'
           and metadata ->> 'timezoneSource' = 'browser'
           and (metadata ->> 'timezoneFirstConfirmation')::boolean
           and (metadata ->> 'otherCount')::int = 1),
  'the audit says the timezone came from the browser — a silent confirmation is never anonymous'
);

-- A known stamp, to prove a second walk through the preparation keeps it.
update public.organizations
set timezone_confirmed_at = timestamptz '2026-01-01 10:00:00+00'
where id = 'e9100000-0000-4000-8000-000000000111';

set local role authenticated;
insert into other_results values (
  'again',
  public.complete_practice_scope(
    'e9100000-0000-4000-8000-000000000111', 'America/Recife', '{}'::text[], '{}'::text[], '{}'::text[], 'kept'
  )
);
reset role;
select is(
  (select timezone_confirmed_at from public.organizations where id = 'e9100000-0000-4000-8000-000000000111'),
  timestamptz '2026-01-01 10:00:00+00',
  'walking the preparation again does not move the first confirmation'
);

set local role authenticated;
insert into other_results values (
  'bad-timezone',
  public.complete_practice_scope(
    'e9100000-0000-4000-8000-000000000111', 'Marte/Olympus', '{}'::text[], '{}'::text[], '{}'::text[], 'chosen'
  )
);
insert into other_results values (
  'bad-other',
  public.complete_practice_scope(
    'e9100000-0000-4000-8000-000000000111', 'America/Recife', '{}'::text[], array['=1+1']::text[], '{}'::text[], 'kept'
  )
);
reset role;
select is(
  (select payload ->> 'code' from other_results where name = 'bad-timezone'),
  'invalid_timezone',
  'a timezone the database does not know is refused'
);
select is(
  (select payload ->> 'code' from other_results where name = 'bad-other'),
  'invalid_modality_other',
  'and so is a free-text label outside the rules — the step validates what the settings card validates'
);

-- Someone who is not a member of the workspace cannot prepare it.
select set_config(
  'request.jwt.claims',
  '{"sub":"e9000000-0000-4000-8000-000000000112","role":"authenticated"}',
  true
);
set local role authenticated;
insert into other_results values (
  'outsider',
  public.complete_practice_scope(
    'e9100000-0000-4000-8000-000000000111', 'America/Sao_Paulo', '{}'::text[], '{}'::text[], '{}'::text[], 'chosen'
  )
);
reset role;
select is(
  (select payload ->> 'code' from other_results where name = 'outsider'),
  'not_authorized',
  'an outsider is refused'
);

-- ---------- The account dossier shows what she typed ----------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e9000000-0000-4000-8000-000000000111","role":"authenticated"}',
  true
);
insert into other_results values ('restore', public.update_practice_modalities_other(array['Tui Na', 'Shiatsu']::text[]));
reset role;

-- A cron with the service key is the dossier's second door (0106).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.admin_account_dossier('e9100000-0000-4000-8000-000000000111') -> 'identity' -> 'modalitiesOther',
  '["Tui Na", "Shiatsu"]'::jsonb,
  'the dossier carries the free-text modalities beside the closed list'
);

select * from finish();
rollback;
