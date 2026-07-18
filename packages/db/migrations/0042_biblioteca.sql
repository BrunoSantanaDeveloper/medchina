-- ============================================================
-- 0042_biblioteca: the clinical library chat (PRD §9.9) — a study
-- assistant grounded in the MTC knowledge collections, usable OUTSIDE
-- the consultation.
--
-- Three pieces:
--  * messages.metadata — the retrieved sources persist WITH the answer,
--    so a reopened conversation still shows what grounded each reply
--    (a citation that disappears on reload is a citation that never
--    existed).
--  * The seeded `biblioteca-mtc` assistant: instructions + knowledge
--    config are data, editable in /admin/ai without a deploy.
--  * A monthly message quota read from plans.limits (configurable data,
--    never a constant — golden rule) through org_message_allowance(),
--    the single SQL answer the app displays and the chat route enforces.
-- ============================================================

-- ---------- Sources travel with the message ----------

alter table public.messages
  add column if not exists metadata jsonb;

comment on column public.messages.metadata is
  'Assistant-message annotations, e.g. {"knowledge_sources": [{index, title, source, kind, trustLevel}]}.';

-- ---------- The study assistant (instructions live in data) ----------

-- max_tokens above the 2048 default: structured study answers (points +
-- locations + formulas + citations) truncate mid-sentence at 2048.
insert into public.assistants (slug, name, description, provider, model, system_prompt, max_tokens, credits_per_message, config, sort)
values (
  'biblioteca-mtc',
  'Biblioteca clínica',
  'Assistente de estudo em Medicina Tradicional Chinesa, fundamentado na biblioteca clínica (fontes tradicionais, protocolos internos e evidência científica). Cita as fontes recuperadas em cada resposta.',
  'gemini',
  'gemini-2.5-flash',
  'Você é a assistente de estudo da biblioteca clínica de uma plataforma de Medicina Tradicional Chinesa usada por profissionais habilitadas (acupuntura, auriculoterapia, moxabustão, ventosaterapia e dietoterapia chinesa). Seu papel é apoiar o ESTUDO e a preparação da profissional fora do atendimento.

Regras:
- Responda no idioma em que a profissional escrever.
- Fundamente cada resposta nos trechos recuperados da biblioteca, citando-os como [n] no ponto exato em que os usa. Nunca invente fontes nem números de citação.
- Quando os trechos recuperados não cobrirem a pergunta (ou cobrirem só em parte), diga isso explicitamente antes de complementar com conhecimento geral — e deixe claro o que veio de onde.
- Quando autores ou tradições divergirem, apresente a divergência em vez de escolher silenciosamente um lado.
- Você NÃO diagnostica nem prescreve conduta para um paciente específico. Se a pergunta descrever um caso concreto, responda no plano do estudo (padrões, pontos, fórmulas, referências) e lembre que a avaliação e a decisão clínica são da profissional.
- Contraindicações e precauções relevantes ao tema perguntado devem ser mencionadas, nunca omitidas para encurtar a resposta.
- Seja direta e organizada; prefira listas curtas a parágrafos longos quando enumerar pontos, fórmulas ou sinais.',
  4096,
  0,
  '{"knowledge": {"collections": ["mtc-fontes-tradicionais", "mtc-protocolos-internos", "mtc-evidencia-cientifica"], "matchCount": 8, "maxTrust": 5}, "quota_limit_key": "library_messages"}'::jsonb,
  10
)
on conflict (slug) do nothing;

-- ---------- Quota: a configurable monthly limit per plan ----------
-- Absence of the key means unlimited; the Gratuito plan starts limited so the
-- library remains the "prove the AI" hook without an open-ended free cost.

update public.plans
set limits = limits || '{"library_messages": 20}'::jsonb
where slug = 'gratuito';

-- The single answer to "may this org send another message to this assistant,
-- and how much is left this month?". Data-driven: the assistant's config names
-- the plans.limits key; no key (or no limit on the plan) means unlimited.
create or replace function public.org_message_allowance(target_org uuid, target_assistant text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  helper public.assistants%rowtype;
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  quota_key text;
  limit_messages integer;
  used_messages integer := 0;
  window_start timestamptz := date_trunc('month', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into helper from public.assistants where slug = target_assistant and is_active;
  if helper.id is null then
    raise exception 'assistant not found';
  end if;

  quota_key := helper.config ->> 'quota_limit_key';
  if quota_key is null then
    return jsonb_build_object('allowed', true, 'unlimited', true);
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  -- Suspended or past_due orgs get nothing, matching org_entitlements().
  if sub.id is null or sub.admin_suspended or sub.status not in ('trialing', 'active') then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0);
  end if;

  select * into plan from public.plans where id = sub.plan_id;
  limit_messages := (plan.limits ->> quota_key)::int;
  if limit_messages is null then
    return jsonb_build_object('allowed', true, 'unlimited', true);
  end if;

  -- Calendar month on purpose: "N mensagens neste mês" must read the same for
  -- the professional regardless of her billing anchor day.
  select count(*) into used_messages
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where c.org_id = target_org
    and c.assistant_id = helper.id
    and m.role = 'user'
    and m.created_at >= window_start;

  return jsonb_build_object(
    'allowed', used_messages < limit_messages,
    'unlimited', false,
    'used', used_messages,
    'limit', limit_messages,
    'window_start', window_start
  );
end;
$$;

grant execute on function public.org_message_allowance(uuid, text) to authenticated;
