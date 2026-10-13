begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- ============================================================
-- Migração 0122 — o WhatsApp da profissional, do cadastro em diante.
--
-- Três regras, e o teste percorre as três:
--   1. o número é obrigatório, sempre;
--   2. confirmar o número é uma chave, que nasce desligada (até lá vale só a
--      confirmação de e-mail e ninguém é retido);
--   3. com a chave ligada, o cadastro comum confirma ANTES de a conta existir
--      e o de campanha nasce pendente e confirma depois do pagamento.
--
-- O GoTrue é simulado ligando a trava nesta sessão
-- (`medchina.signup_gate = 'enforce'`) — o papel dele não pode ser assumido
-- aqui, e a configuração só ACRESCENTA a trava, nunca a tira.
-- ============================================================

create temp table started (label text primary key, result jsonb) on commit drop;

-- Tokens com o formato que o navegador guarda (43 caracteres base64url) e o
-- hash que o banco vê.
create temp table tokens (label text primary key, token text, hash text) on commit drop;
insert into tokens
select label, repeat(letter, 43), encode(extensions.digest(repeat(letter, 43), 'sha256'), 'hex')
from (values ('ana', 'a'), ('bia', 'b'), ('caio', 'c'), ('dani', 'd'), ('eva', 'e'),
             ('gil', 'g'), ('hugo', 'h'), ('iris', 'i')) as t(label, letter);

-- Quem opera a chave, e quem não pode.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e5000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'operadora@medchina.invalid', '', '{}', '{"display_name":"Operadora"}', now(), now()),
  ('e5000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comum@medchina.invalid', '', '{}', '{"display_name":"Comum"}', now(), now());
update public.profiles set is_superadmin = true where id = 'e5000000-0000-4000-8000-0000000000a1';

select is(
  (select count(*)::int from public.account_whatsapp
   where user_id in ('e5000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-0000000000a2')),
  0,
  'uma sessão SQL direta (migração, fixture) fica fora da trava e não ganha linha'
);

-- ---------- Quem pode chamar ----------

set local role anon;
select throws_ok(
  $$ select public.start_signup_verification('x@medchina.invalid', repeat('f', 64)) $$,
  '42501', null,
  'anon não chama o início da verificação (só o servidor, com a service role)'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select * from public.signup_verifications $$,
  '42501', null,
  'uma sessão autenticada não lê as verificações em andamento'
);
select throws_ok(
  $$ select public.set_signup_whatsapp_confirmation(true) $$,
  '42501', null,
  'quem não é superadmin não mexe na chave'
);
reset role;

-- ---------- Regra 2: a chave nasce desligada ----------

select is(public.signup_whatsapp_confirmation_on(), false, 'a confirmação por WhatsApp nasce desligada');

set local medchina.signup_gate = 'enforce';

-- ---------- Regra 1: o número é obrigatório, com a chave desligada também ----------

select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'semnumero@medchina.invalid', '',
       '{"provider":"email"}', '{"display_name":"Sem Número"}', now(), now()) $$,
  'P0001', 'whatsapp_number_required',
  'sem número de WhatsApp, o GoTrue não cria a conta'
);

select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'email@medchina.invalid', '',
       '{"provider":"email"}', '{"display_name":"Só E-mail","whatsapp":"+55 (11) 97777-1111"}', now(), now()) $$,
  'com o número, e a chave desligada, a conta nasce como sempre nasceu'
);

select is(
  (select row(phone, confirmation_required, verified_at is null)::text
   from public.account_whatsapp where user_id = 'e5000000-0000-4000-8000-000000000001'),
  '(5511977771111,f,t)',
  'o número declarado fica na conta, em dígitos, e ela não deve confirmação nenhuma'
);
select ok(
  (select not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'whatsapp_pending')
   from auth.users where id = 'e5000000-0000-4000-8000-000000000001'),
  'com a chave desligada ninguém nasce pendente'
);

-- ---------- A operadora liga a chave ----------

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.set_signup_whatsapp_confirmation(true) ->> 'enabled', 'true',
  'a superadmin liga a confirmação'
);
reset role;
select is(public.signup_whatsapp_confirmation_on(), true, 'e a chave passa a valer');

select is(
  (select confirmation_required from public.account_whatsapp
   where user_id = 'e5000000-0000-4000-8000-000000000001'),
  false,
  'quem se cadastrou no regime de e-mail não passa a dever confirmação'
);

-- ---------- Regra 3a: cadastro comum confirma ANTES de a conta existir ----------

insert into started
select 'ana', public.start_signup_verification(
  'Ana@MedChina.Invalid', (select hash from tokens where label = 'ana'), null, 'pt-BR');

select matches(
  (select result ->> 'code' from started where label = 'ana'),
  '^[A-HJ-NP-Z2-9]{6}$',
  'o código tem seis símbolos do alfabeto sem I/O/0/1'
);
select is(
  public.signup_verification_status((select hash from tokens where label = 'ana')) ->> 'status',
  'pending',
  'antes da mensagem, o estado é pendente'
);
select is(
  public.confirm_signup_verification(array['ZZZZZZ'], '5511988887777') ->> 'code',
  'not_found',
  'um código que não está pendente não confirma nada'
);
select ok(
  (public.confirm_signup_verification(
    -- Palavras com cara de código ao redor do código de verdade, em minúsculas:
    -- a frase traduzida e a edição dela não podem atrapalhar.
    array['NUMBER', 'MEDCHI', lower((select result ->> 'code' from started where label = 'ana'))],
    '5511988887777'
  ) ->> 'ok')::boolean,
  'o código, no meio de outras palavras, confirma'
);
select is(
  public.signup_verification_status((select hash from tokens where label = 'ana')),
  '{"status":"confirmed","phone_hint":"7777"}'::jsonb,
  'confirmado, e só os quatro últimos dígitos voltam para a tela'
);

select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'outra@medchina.invalid', '',
       '{"provider":"email"}',
       jsonb_build_object('whatsapp', '5511900000000', 'whatsapp_verification', repeat('a', 43)), now(), now()) $$,
  'P0001', 'whatsapp_verification_invalid',
  'um token confirmado não serve para outro e-mail — e não vira "pendente" em silêncio'
);

select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'ana@medchina.invalid', '',
       '{"provider":"email"}',
       jsonb_build_object('display_name', 'Ana', 'whatsapp', '5511900000000',
                          'whatsapp_verification', repeat('a', 43)), now(), now()) $$,
  'com o token confirmado e o mesmo e-mail, a conta nasce'
);

select is(
  (select row(phone, verified_at is not null)::text
   from public.account_whatsapp where user_id = 'e5000000-0000-4000-8000-000000000002'),
  '(5511988887777,t)',
  'ela nasce confirmada, com o número que ENVIOU a mensagem (não o digitado)'
);
select ok(
  (select not (raw_user_meta_data ? 'whatsapp_verification')
          and not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'whatsapp_pending')
          and raw_user_meta_data ->> 'display_name' = 'Ana'
          and phone is null and phone_confirmed_at is null
   from auth.users where id = 'e5000000-0000-4000-8000-000000000002'),
  'o token sai dos metadados, ela não fica pendente, e as colunas de telefone do GoTrue não são tocadas'
);
select is(
  (select count(*)::int from public.signup_verifications
   where token_hash = (select hash from tokens where label = 'ana')),
  0,
  'a verificação é consumida'
);

select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'ana@medchina.invalid', '',
       '{"provider":"email"}',
       jsonb_build_object('whatsapp', '5511900000000', 'whatsapp_verification', repeat('a', 43)), now(), now()) $$,
  'P0001', 'whatsapp_verification_invalid',
  'o mesmo token não cria uma segunda conta'
);

-- Uma confirmação de mais de uma hora atrás já não cria conta.
insert into started
select 'dani', public.start_signup_verification('dani@medchina.invalid', (select hash from tokens where label = 'dani'));
do $do$ begin
  perform public.confirm_signup_verification(
    array[(select result ->> 'code' from started where label = 'dani')], '5521966665555');
end $do$;
update public.signup_verifications set verified_at = now() - interval '2 hours'
where token_hash = (select hash from tokens where label = 'dani');

select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'dani@medchina.invalid', '',
       '{"provider":"email"}',
       jsonb_build_object('whatsapp', '5521966665555', 'whatsapp_verification', repeat('d', 43)), now(), now()) $$,
  'P0001', 'whatsapp_verification_invalid',
  'uma confirmação de mais de uma hora atrás não cria conta'
);

-- ---------- Regra 3b: cadastro de campanha nasce pendente e confirma depois ----------

select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('e5000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'bia@medchina.invalid', '',
       '{"provider":"email","providers":["email"]}',
       '{"display_name":"Bia","whatsapp":"5531955554444"}', now(), now()) $$,
  'sem confirmação, com a chave ligada, a conta nasce mesmo assim (ela vai pagar primeiro)'
);

select is(
  (select row(phone, confirmation_required, verified_at is null)::text
   from public.account_whatsapp where user_id = 'e5000000-0000-4000-8000-000000000005'),
  '(5531955554444,t,t)',
  'mas nasce devendo a confirmação'
);
select is(
  (select raw_app_meta_data -> 'whatsapp_pending' from auth.users
   where id = 'e5000000-0000-4000-8000-000000000005'),
  'true'::jsonb,
  'e a sessão dela carrega a marca de pendente'
);

-- O GoTrue regrava os dois metadados logo depois do insert, com a cópia que
-- ele tem da requisição: o token voltava e a marca de pendente sumia.
update auth.users
set raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
    raw_user_meta_data = raw_user_meta_data || jsonb_build_object('whatsapp_verification', repeat('z', 43), 'sub', 'x')
where id = 'e5000000-0000-4000-8000-000000000005';

select ok(
  (select raw_app_meta_data -> 'whatsapp_pending' = 'true'::jsonb
          and raw_app_meta_data ->> 'provider' = 'email'
          and not (raw_user_meta_data ? 'whatsapp_verification')
          and raw_user_meta_data ->> 'sub' = 'x'
   from auth.users where id = 'e5000000-0000-4000-8000-000000000005'),
  'a regravação do GoTrue não apaga a marca nem traz o token de volta (e o resto da escrita passa)'
);

-- Ela só enxerga a própria linha, e não escreve nela.
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.account_whatsapp), 1,
  'a profissional lê só o próprio número'
);
select throws_ok(
  $$ update public.account_whatsapp set verified_at = now() $$,
  '42501', null,
  'e não consegue se declarar confirmada'
);
reset role;

-- Depois do pagamento, a tela de confirmação pede um código para a CONTA.
insert into started
select 'bia', public.start_signup_verification(
  'bia@medchina.invalid', (select hash from tokens where label = 'bia'), null, 'pt-BR',
  'e5000000-0000-4000-8000-000000000005');

select ok((select (result ->> 'ok')::boolean from started where label = 'bia'), 'a conta pendente recebe um código');
select is(
  public.start_signup_verification(
    'ana@medchina.invalid', (select hash from tokens where label = 'gil'), null, 'pt-BR',
    'e5000000-0000-4000-8000-000000000002') ->> 'code',
  'not_pending',
  'uma conta que já confirmou não recebe outro'
);

-- O número da Ana já pertence a uma conta confirmada.
select is(
  public.confirm_signup_verification(
    array[(select result ->> 'code' from started where label = 'bia')], '5511988887777') ->> 'code',
  'phone_taken',
  'um WhatsApp já confirmado em outra conta é recusado'
);
select is(
  public.signup_verification_status((select hash from tokens where label = 'bia')) ->> 'status',
  'phone_taken',
  'e a tela fica sabendo'
);

insert into started
select 'bia2', public.start_signup_verification(
  'bia@medchina.invalid', (select hash from tokens where label = 'hugo'), null, 'pt-BR',
  'e5000000-0000-4000-8000-000000000005');

select ok(
  (public.confirm_signup_verification(
    array[(select result ->> 'code' from started where label = 'bia2')], '5531955550000') ->> 'ok')::boolean,
  'com o WhatsApp dela, a conta pendente confirma'
);
select is(
  (select row(phone, verified_at is not null)::text
   from public.account_whatsapp where user_id = 'e5000000-0000-4000-8000-000000000005'),
  '(5531955550000,t)',
  'o número confirmado substitui o declarado'
);
select ok(
  (select not (raw_app_meta_data ? 'whatsapp_pending') and raw_app_meta_data ->> 'provider' = 'email'
   from auth.users where id = 'e5000000-0000-4000-8000-000000000005'),
  'e a marca de pendente sai da sessão'
);
select is(
  public.signup_verification_status((select hash from tokens where label = 'hugo')) ->> 'status',
  'confirmed',
  'a tela que esperava vê a confirmação'
);

-- Um número DECLARADO pode se repetir: só o confirmado é único.
select lives_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values
     ('e5000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'caio@medchina.invalid', '',
       '{"provider":"email"}', '{"display_name":"Caio","whatsapp":"5511988887777"}', now(), now()),
     ('e5000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'eva@medchina.invalid', '',
       '{"provider":"email"}', '{"display_name":"Eva","whatsapp":"5511988887777"}', now(), now()) $$,
  'digitar um número que já existe não barra o cadastro nem revela que ele tem conta'
);

-- ---------- Prazos e limites ----------

insert into started
select 'caio', public.start_signup_verification('caio@medchina.invalid', (select hash from tokens where label = 'caio'));
update public.signup_verifications set expires_at = now() - interval '1 minute'
where token_hash = (select hash from tokens where label = 'caio');

select is(
  public.confirm_signup_verification(
    array[(select result ->> 'code' from started where label = 'caio')], '5511977776666') ->> 'code',
  'not_found',
  'código vencido não confirma'
);

do $do$ begin
  perform public.start_signup_verification('lote@medchina.invalid', encode(extensions.digest('lote' || n, 'sha256'), 'hex'))
  from generate_series(1, 6) as n;
end $do$;

select is(
  public.start_signup_verification('lote@medchina.invalid', (select hash from tokens where label = 'eva')) ->> 'code',
  'too_many',
  'o sétimo pedido do mesmo e-mail em uma hora é recusado'
);

-- ---------- Desligar a chave solta quem estava esperando ----------

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(
  public.set_signup_whatsapp_confirmation(false),
  '{"enabled":false,"released":2}'::jsonb,
  'desligar devolve quantas contas estavam retidas (Caio e Eva)'
);
reset role;

select ok(
  (select not exists (
     select 1 from public.account_whatsapp where confirmation_required and verified_at is null)
   and not exists (
     select 1 from auth.users where raw_app_meta_data ? 'whatsapp_pending')),
  'ninguém fica preso numa tela que não tem mais como liberar'
);
select is(
  (select verified_at is not null from public.account_whatsapp
   where user_id = 'e5000000-0000-4000-8000-000000000005'),
  true,
  'e quem já tinha confirmado continua confirmada'
);

-- ---------- O console de contas enxerga o número ----------

insert into public.organizations (id, name, slug, created_by)
values ('e5100000-0000-4000-8000-000000000001', 'Espaço Bia', 'espaco-bia-e5100001',
        'e5000000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role)
values ('e5100000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000005', 'owner')
on conflict do nothing;

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select ok(
  jsonb_path_exists(public.admin_accounts_overview(), '$.** ? (@.phone == "5531955550000")'),
  'o telefone da conta aparece no console, vindo de account_whatsapp'
);
reset role;

select * from finish();
rollback;
