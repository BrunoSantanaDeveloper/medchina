begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ============================================================
-- Migration 0093 — fechar a consulta avisa, e não inutiliza o receituário.
--
-- Duas propriedades que só existem juntas:
--
--   * finalize_consultation enumera TUDO que ficou pendente antes de deixar
--     fechar — inclusive um receituário em rascunho, que antes não gerava
--     aviso algum e congelava inassinável;
--   * depois de fechada, a ASSINATURA continua possível e o CONTEÚDO não.
--     Essa é a linha inteira: um documento assinado atesta o que o registro
--     já dizia, então permitir assinar não é permitir reescrever.
--
-- O risco desta migração é afrouxar o congelamento clínico (PRD §8.5) por
-- acidente, então cada caminho de escrita é exercitado como a profissional:
-- validar passa, editar não, apagar não, criar não.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'freeze-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Freeze Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('e2000000-0000-4000-8000-000000000001', 'Freeze practice', 'freeze-practice',
        'e1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Paciente Freeze',
        'e1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, chief_complaint, created_by)
values ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
        'e3000000-0000-4000-8000-000000000001', 'in_progress', 'Dor lombar',
        'e1000000-0000-4000-8000-000000000001');

-- A herbal formula written at the end of the appointment and not yet signed —
-- the exact state the professional is in when she reaches for "Finalizar".
insert into public.consultation_prescriptions (
  id, org_id, consultation_id, kind, title, items, posology, status, created_by
) values (
  'e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001', 'herbal', 'Fórmula para Frio no Baço',
  '[{"name":"Gan Jiang","amount":"6g"}]'::jsonb, '1 dose ao dia, após as refeições',
  'draft', 'e1000000-0000-4000-8000-000000000001'
);

create temporary table freeze_results (name text primary key, payload jsonb);
grant select, insert on table freeze_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

-- ---------- Fechar avisa antes ----------

insert into freeze_results
select 'unacknowledged', public.finalize_consultation(
  'e4000000-0000-4000-8000-000000000001',
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  array[]::text[]
);

select is(
  (select payload ->> 'code' from freeze_results where name = 'unacknowledged'),
  'finalization_confirmation_required',
  'closing stops on what still needs a look instead of closing silently'
);

select ok(
  (select payload -> 'warnings' from freeze_results where name = 'unacknowledged')
    @> '["draft_prescription"]'::jsonb,
  'an unsigned prescription is one of the things it warns about'
);

select is(
  (select status from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  'in_progress',
  'and the consultation stays open until she acknowledges'
);

insert into freeze_results
select 'acknowledged', public.finalize_consultation(
  'e4000000-0000-4000-8000-000000000001',
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  array['draft_prescription']
);

select ok(
  coalesce(((select payload from freeze_results where name = 'acknowledged') ->> 'ok')::boolean, false),
  'acknowledging the warning closes the record'
);

select is(
  (select status from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  'finalized',
  'the consultation is finalized'
);

-- ---------- Depois de fechada: assinar sim, reescrever não ----------

select lives_ok(
  $$update public.consultation_prescriptions
    set status = 'validated', validated_by = 'e1000000-0000-4000-8000-000000000001', validated_at = now()
    where id = 'e5000000-0000-4000-8000-000000000001'$$,
  'a prescription drafted before closing can still be signed afterwards'
);

select is(
  (select status from public.consultation_prescriptions where id = 'e5000000-0000-4000-8000-000000000001'),
  'validated',
  'and the signature is recorded, so the PDF can be issued'
);

select throws_ok(
  $$update public.consultation_prescriptions
    set posology = 'Duas doses ao dia'
    where id = 'e5000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'but its content can never be rewritten after the record is closed'
);

select throws_ok(
  $$update public.consultation_prescriptions
    set items = '[{"name":"Fu Zi","amount":"9g"}]'::jsonb, status = 'validated'
    where id = 'e5000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'and content cannot ride along with a status change'
);

select throws_ok(
  $$delete from public.consultation_prescriptions where id = 'e5000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a closed prescription cannot be deleted'
);

select throws_ok(
  $$insert into public.consultation_prescriptions (org_id, consultation_id, kind, title, items, status, created_by)
    values ('e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
            'generic', 'Nova receita', '[]'::jsonb, 'draft', 'e1000000-0000-4000-8000-000000000001')$$,
  '23514',
  null,
  'and no new prescription can be added to a closed consultation'
);

reset role;

select * from finish();
rollback;
