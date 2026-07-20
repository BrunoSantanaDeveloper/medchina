-- ============================================================
-- 0046_plan_copy_library: the plan descriptions now say what the
-- out-of-consultation layer (fases 1-4) actually gives each tier.
--
-- The library was built but never mentioned where the purchase
-- decision happens: the billing page and the public /planos both
-- render `plans.description` (a configurable row, never a constant),
-- so the copy lives here and stays superadmin-editable.
-- ============================================================

update public.plans
set description = 'Prontuário, pacientes e consultas manuais sem limite, com 20 perguntas por mês à biblioteca clínica. Sem gravação por IA.'
where slug = 'gratuito';

update public.plans
set description = 'Documentação automatizada: gravação, transcrição e anamnese preenchida para sua revisão — com a biblioteca clínica sem limite de perguntas.'
where slug = 'assistente';

update public.plans
set description = 'Tudo do Assistente, mais a preparação do raciocínio terapêutico para sua validação e a revisão dos casos dos seus pacientes na biblioteca.'
where slug = 'pro';
