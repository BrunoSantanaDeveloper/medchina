begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ============================================================
-- Migração 0102 — a IA sobre o que foi digitado não pede autorização,
-- mas respeita quem disse não.
--
-- Nunca ter sido perguntada NÃO é recusa: era isso que travava a ferramenta
-- numa consulta inteiramente manual e nas pacientes migradas de outro sistema,
-- que nunca passaram pelo fluxo de consentimento. Dizer não, sim — e ela é dita
-- de duas formas que o banco guarda em lugares diferentes: revogando um aceite
-- (revoked_at) ou recusando no próprio aparelho, que não cria aceite nenhum
-- (patient_consent_session_items.decision = false).
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-notice@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"AI Notice Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('e2000000-0000-4000-8000-000000000001', 'AI notice practice', 'ai-notice-practice',
        'e1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Paciente Digitada',
   'e1000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Paciente Que Recusou',
   'e1000000-0000-4000-8000-000000000001');

-- A ciência é um termo como os outros: versionada, com texto próprio.
select is(
  (select count(*)::int from public.consent_terms where slug = 'ai-record-notice' and is_active),
  1,
  'a ciência de IA existe como termo ativo'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  not public.patient_refused_ai_reasoning(
    'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001'
  ),
  'nunca perguntada não é recusa'
);

select ok(
  (public.set_patient_consent('e3000000-0000-4000-8000-000000000001', 'ai-processing', true, '{"method":"in_person"}'::jsonb) ->> 'ok')::boolean,
  'a profissional registra a autorização'
);

select ok(
  not public.patient_refused_ai_reasoning(
    'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001'
  ),
  'com aceite ativo, também não há recusa'
);

select ok(
  (public.set_patient_consent('e3000000-0000-4000-8000-000000000001', 'ai-processing', false) ->> 'ok')::boolean,
  'e depois revoga'
);

select ok(
  public.patient_refused_ai_reasoning(
    'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001'
  ),
  'revogar É recusa: o raciocínio sobre o prontuário para'
);

-- A recusa no aparelho da paciente: nenhum aceite é criado, então ela só existe
-- na decisão gravada da sessão. Escrita aqui direto, como o RPC de serviço faz.
reset role;
insert into public.patient_consent_sessions (
  id, org_id, patient_id, token_hash, client_request_id, created_by, expires_at, status
) values (
  'e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  repeat('a', 64), gen_random_uuid(), 'e1000000-0000-4000-8000-000000000001',
  now() + interval '15 minutes', 'pending'
);
insert into public.patient_consent_session_items (
  session_id, term_id, slug, term_title, term_body, term_version, decision, decided_at
)
select 'e4000000-0000-4000-8000-000000000001', t.id, t.slug, t.title, t.body, t.version, false, now()
from public.consent_terms t
where t.slug = 'ai-processing' and t.is_active
order by t.version desc
limit 1;
set local role authenticated;

select ok(
  public.patient_refused_ai_reasoning(
    'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002'
  ),
  'recusar no próprio aparelho também é recusa, sem aceite nenhum para revogar'
);

reset role;
select * from finish();
rollback;
