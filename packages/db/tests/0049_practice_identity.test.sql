begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ============================================================
-- Migração 0121 — o consultório ganha identidade própria.
--
-- Três coisas que este teste existe para travar:
--
--  * A obrigatoriedade vive na RPC, NÃO na coluna. Telefone, e-mail, cidade e
--    UF são exigidos de quem salva a tela; as colunas seguem nullable porque há
--    contas em produção anteriores a ela.
--  * A identidade do consultório é INDEPENDENTE da cobrança (decisão de
--    produto, 2026-10-12). Salvar o CNPJ da clínica não pode encostar em
--    billing_cpf_cnpj — se um dia encostar, a nota e o receituário passam a
--    discordar sem ninguém perceber.
--  * O preparo da prática continua confirmando o fuso SEM endereço. Endurecer a
--    tela do consultório não podia endurecer o onboarding junto.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'practice-identity@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Identity Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by, timezone, billing_cpf_cnpj)
values (
  'c9100000-0000-4000-8000-000000000001', 'Clinica Identidade', 'clinica-identidade',
  'c9000000-0000-4000-8000-000000000001', 'America/Sao_Paulo', '11111111111'
);
insert into public.memberships (org_id, user_id, role)
values ('c9100000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

-- ---------- Os quatro obrigatórios da tela ----------

select throws_ok(
  $$select public.update_practice_settings(
      'c9100000-0000-4000-8000-000000000001', 'Clinica Identidade', 'America/Sao_Paulo',
      null, null, 'contato@clinica.test', null, null, null, null, null, 'Goiania', 'GO')$$,
  '22023',
  'invalid_practice_phone',
  'sem telefone a tela nao salva'
);

select throws_ok(
  $$select public.update_practice_settings(
      'c9100000-0000-4000-8000-000000000001', 'Clinica Identidade', 'America/Sao_Paulo',
      null, '62999887766', null, null, null, null, null, null, 'Goiania', 'GO')$$,
  '22023',
  'invalid_practice_email',
  'sem e-mail a tela nao salva'
);

select throws_ok(
  $$select public.update_practice_settings(
      'c9100000-0000-4000-8000-000000000001', 'Clinica Identidade', 'America/Sao_Paulo',
      null, '62999887766', 'contato@clinica.test', null, null, null, null, null, null, 'GO')$$,
  '22023',
  'invalid_practice_city',
  'sem cidade a tela nao salva'
);

-- "XX" tem duas letras e passaria por qualquer checagem de formato.
select throws_ok(
  $$select public.update_practice_settings(
      'c9100000-0000-4000-8000-000000000001', 'Clinica Identidade', 'America/Sao_Paulo',
      null, '62999887766', 'contato@clinica.test', null, null, null, null, null, 'Goiania', 'XX')$$,
  '22023',
  'invalid_practice_state',
  'UF fora da federacao e recusada'
);

-- ---------- O salvamento completo ----------

select is(
  (public.update_practice_settings(
     'c9100000-0000-4000-8000-000000000001', 'Clinica da Debora', 'America/Sao_Paulo',
     '12.345.678/0001-95', '(62) 99988-7766', '  Contato@Clinica.TEST ', '74000-000',
     'Rua das Flores', '120', 'Sala 3', 'Setor Central', 'Goiania', 'go'
   ) ->> 'code'),
  'updated',
  'com os obrigatorios preenchidos, salva'
);

-- Dígitos, nunca a máscara: a regra do repositório para campo semântico.
select results_eq(
  $$select practice_document, practice_phone, practice_email, practice_postal_code, practice_state
      from public.organizations where id = 'c9100000-0000-4000-8000-000000000001'$$,
  $$values ('12345678000195', '62999887766', 'contato@clinica.test', '74000000', 'GO')$$,
  'mascara, espaco e caixa sao normalizados antes de gravar'
);

-- ---------- A cobranca nao e tocada ----------

select is(
  (select billing_cpf_cnpj from public.organizations where id = 'c9100000-0000-4000-8000-000000000001'),
  '11111111111',
  'salvar o CNPJ da clinica nao altera o documento da cobranca'
);

-- ---------- A auditoria nao vira um segundo cadastro ----------

select ok(
  (select metadata::text not like '%12345678000195%'
      and metadata::text not like '%Rua das Flores%'
      and (metadata ->> 'documentChanged')::boolean
     from public.audit_events
    where org_id = 'c9100000-0000-4000-8000-000000000001'
      and action = 'org.settings.updated'
    order by created_at desc
    limit 1),
  'a auditoria registra que mudou, nunca o documento nem o endereco'
);

-- ---------- O preparo da pratica segue livre ----------
-- Se esta falhar, endurecer a tela do consultorio endureceu o onboarding junto.

select ok(
  (public.complete_practice_context(
     'c9100000-0000-4000-8000-000000000001', 'America/Bahia', array['acupuncture']
   ) ->> 'ok')::boolean,
  'confirmar o fuso no preparo nao exige endereco nem contato'
);

reset role;
select * from finish();
rollback;
