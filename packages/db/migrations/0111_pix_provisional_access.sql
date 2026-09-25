-- ---------------------------------------------------------------------------
-- 0111 — Pro provisório enquanto o PIX é confirmado
-- ---------------------------------------------------------------------------
-- DECISÃO DO OPERADOR (2026-09-24): quem escolheu PIX e ainda não teve o
-- pagamento confirmado pelo webhook deve poder USAR o Pro — gravar com IA, ter
-- o raciocínio clínico — para concluir o onboarding sem esperar o banco. Se o
-- pagamento não for validado "até a próxima sessão", o Pro é desabilitado. E a
-- oferta de teste Pro aparece SÓ para quem não passou por uma via de pagamento.
--
-- POR QUE AQUI, NO SQL. `org_audio_allowance` é a única resposta que o banco
-- (begin_clinical_recording, apply_recording_result, start_pro_trial) e toda a
-- interface compartilham. Liberar o Pro só na tela produziria um botão "Gravar"
-- que o banco recusa.
--
-- POR QUE NADA FUNCIONAVA ANTES. A função escolhe "a assinatura viva mais
-- recente" — e TODA conta tem o Gratuito ativo. O PIX pendente fica
-- `incomplete`, que nunca é vivo (subscriptions_org_live_unique). Então quem
-- acabou de pagar via PIX era tratada exatamente como alguém sem plano, e via a
-- oferta de teste Pro.
--
-- O QUE MUDA
--   1. `subscriptions.payment_method` e `subscriptions.provisional_until`.
--   2. `mark_pix_checkout`: chamada pelo servidor logo após o checkout PIX,
--      grava o método e abre a janela — UMA VEZ POR WORKSPACE. Sem isso,
--      gerar PIX sem pagar viraria uma fonte recorrente de Pro gratuito.
--   3. `org_audio_allowance`:
--      - durante a janela, o plano do PIX pendente vale como plano (gravar,
--        raciocínio), marcado `provisional: true` para a interface continuar
--        dizendo "confirmando pagamento" em vez de "Plano X";
--      - a janela fecha antes do prazo se a cobrança VENCEU (o webhook grava a
--        fatura como `failed` e mantém a assinatura `incomplete` — ver
--        payment_failed na rota de webhook, que só move trialing/active);
--      - com PIX pendente, `trial_available` é falso — nem oferta nem trial
--        automático (start_pro_trial lê exatamente esse campo);
--      - vencida a janela sem pagamento: `reason = 'payment_unconfirmed'`, para
--        a tela pedir a conclusão do pagamento em vez de oferecer teste;
--      - pacote de minutos não é vendável durante o provisório: nada foi pago.
--
-- DE ONDE VEM O NÚMERO
--   Janela = 24 horas. "Até a próxima sessão" foi traduzido em tempo, e não na
--   sessão de login: a sessão do Supabase persiste por semanas (quem não sai
--   nunca teria "próxima sessão"), e o app móvel de captura abre uma sessão
--   própria — atada ao login, a gravação pelo celular seria recusada no meio do
--   onboarding. 24h cobrem a sessão de uso em curso e fecham no dia seguinte.
--   Ajustável em platform_settings.pix_provisional_access.hours.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists payment_method text,
  add column if not exists provisional_until timestamptz;

alter table public.subscriptions drop constraint if exists subscriptions_payment_method_check;
alter table public.subscriptions
  add constraint subscriptions_payment_method_check
  check (payment_method is null or payment_method in ('pix', 'credit_card'));

comment on column public.subscriptions.provisional_until is
  'Até quando um PIX ainda não confirmado libera o plano (0111). Uma vez por workspace; gravado por mark_pix_checkout.';

insert into public.platform_settings (key, value)
values ('pix_provisional_access', jsonb_build_object('enabled', true, 'hours', 24))
on conflict (key) do nothing;

-- ---------- Marcar um checkout PIX ----------

create or replace function public.mark_pix_checkout(target_org uuid, target_provider_subscription text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  config jsonb;
  window_hours integer;
  granted_before boolean;
  marked public.subscriptions%rowtype;
begin
  -- Só o servidor, logo após criar a cobrança. Um cliente que pudesse chamar
  -- isto abriria sua própria janela de Pro.
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select value into config from public.platform_settings where key = 'pix_provisional_access';
  window_hours := greatest(coalesce((config ->> 'hours')::integer, 24), 1);

  -- Uma janela por workspace, para sempre. Sem isto, um PIX gerado e não pago
  -- a cada plano diferente renderia uma nova janela de Pro.
  select exists (
    select 1 from public.subscriptions
    where org_id = target_org and provisional_until is not null
  ) into granted_before;

  update public.subscriptions s
  set payment_method = 'pix',
      provisional_until = case
        when s.provisional_until is not null then s.provisional_until  -- replay: mantém
        when coalesce((config ->> 'enabled')::boolean, false) and not granted_before
          then now() + make_interval(hours => window_hours)
        else null
      end,
      updated_at = now()
  where s.org_id = target_org
    and s.provider_subscription_id = target_provider_subscription
    and s.status = 'incomplete'
  returning * into marked;

  if marked.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'provisional_until', marked.provisional_until);
end;
$$;

revoke all on function public.mark_pix_checkout(uuid, text) from public;
revoke all on function public.mark_pix_checkout(uuid, text) from anon, authenticated;
grant execute on function public.mark_pix_checkout(uuid, text) to service_role;

-- ---------- A franquia ----------
-- Corpo da 0069, inalterado exceto pelos trechos marcados "0111".

create or replace function public.org_audio_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  trial public.pro_trials%rowtype;
  window_start timestamptz;
  window_end timestamptz;
  limit_minutes integer := 0;
  used_seconds bigint := 0;
  used_minutes integer := 0;
  percent integer := 0;
  src text := 'none';
  plan_minutes integer := 0;
  trial_available boolean := false;
  cycle_can_start boolean := false;
  cycle_expired boolean := false;
  cycle_remaining integer := 0;
  can_start boolean := false;
  can_reason boolean := false;
  suspended boolean := false;
  grace_ends timestamptz;
  in_grace boolean := false;
  plan_usable boolean := false;
  pack_seconds_left bigint := 0;
  pack_minutes_left integer := 0;
  pack_purchasable boolean := false;
  reason text;
  -- 0111
  pix_sub public.subscriptions%rowtype;
  pix_pending boolean := false;
  provisional boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if sub.id is not null then
    select * into plan from public.plans where id = sub.plan_id;
    plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
  end if;

  suspended := coalesce(sub.admin_suspended, false);
  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  plan_usable := sub.id is not null
    and not suspended
    and (sub.status in ('trialing', 'active') or in_grace);

  -- 0111: a PIX charge she started and the provider has not confirmed.
  select * into pix_sub
  from public.subscriptions
  where org_id = target_org and status = 'incomplete' and payment_method = 'pix'
  order by created_at desc
  limit 1;
  pix_pending := pix_sub.id is not null;

  -- 0111: the pending plan stands in for the live one while the window is
  -- open — but never over a plan she already holds with minutes, never over
  -- the kill-switch, and never once the charge itself has gone overdue.
  if pix_pending
     and not suspended
     and not (plan_usable and plan_minutes > 0)
     and pix_sub.provisional_until is not null
     and pix_sub.provisional_until > now()
     and not exists (
       select 1 from public.invoices i
       where i.subscription_id = pix_sub.id and i.status = 'failed'
     ) then
    provisional := true;
    sub := pix_sub;
    select * into plan from public.plans where id = pix_sub.plan_id;
    plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
    grace_ends := null;
    in_grace := false;
    plan_usable := true;
  end if;

  select * into trial from public.pro_trials where org_id = target_org;

  if plan_minutes > 0 then
    if plan_usable then
      src := 'plan';
      limit_minutes := plan_minutes;
      if provisional then
        -- 0111: the provisional window is its own usage window; the real
        -- cycle starts when the webhook confirms the charge.
        window_start := pix_sub.created_at;
        window_end := pix_sub.provisional_until;
      else
        window_start := coalesce(sub.current_period_start, date_trunc('month', now()));
        window_end := coalesce(sub.current_period_end, window_start + interval '1 month');
      end if;
    end if;
  elsif trial.org_id is not null and not suspended then
    src := 'trial';
    limit_minutes := trial.minutes_limit;
    window_start := trial.started_at;
    window_end := trial.ends_at;
  end if;

  -- 0111: someone who came through a payment path is not offered the trial,
  -- and — because start_pro_trial reads exactly this — does not get one started
  -- automatically either. Otherwise the trial would quietly keep Pro alive
  -- after the provisional window, and "desabilitado" would never happen.
  trial_available := trial.org_id is null and plan_minutes = 0 and not suspended and not pix_pending;

  -- Cycle consumption counts only what the CYCLE funded. Summing `seconds`
  -- here would charge pack-funded minutes to the cycle as well, so a pack
  -- would burn both pools at once.
  if src <> 'none' then
    select coalesce(sum(cycle_seconds), 0) into used_seconds
    from public.audio_usage
    where org_id = target_org
      and created_at >= window_start
      and (window_end is null or created_at < window_end);
  end if;

  used_minutes := ceil(used_seconds / 60.0);

  if limit_minutes > 0 then
    percent := least(floor(used_minutes * 100.0 / limit_minutes)::int, 999);
    cycle_can_start := used_minutes < limit_minutes;
  end if;

  -- The trial has two independent ends (days OR minutes). When TIME is what
  -- ran out, the leftover minutes are gone with it: reporting them as
  -- remaining is what made the usage card contradict the recorder.
  if src = 'trial' and now() >= trial.ends_at then
    cycle_can_start := false;
    cycle_expired := true;
  end if;

  cycle_remaining := case when cycle_expired then 0 else greatest(limit_minutes - used_minutes, 0) end;
  if cycle_expired then
    percent := greatest(percent, 100);
  end if;

  -- Already paid for, so it survives everything except the kill-switch.
  if not suspended then
    select coalesce(sum(seconds_total - seconds_consumed), 0) into pack_seconds_left
    from public.audio_minute_packs
    where org_id = target_org
      and seconds_consumed < seconds_total
      and (expires_at is null or expires_at > now());
  end if;

  -- Floor, never ceil: a remaining balance must not promise a minute that is
  -- not there. The cost is that the last sub-minute reads as 0 while still
  -- being usable, which errs in the customer's favour.
  pack_minutes_left := floor(pack_seconds_left / 60.0);
  can_start := cycle_can_start or pack_seconds_left > 0;

  if src = 'trial' then
    -- The trial IS Pro, and it ends with the trial — there is no payment
    -- behind it to keep the entitlement alive.
    can_reason := can_start;
  elsif src = 'plan' then
    -- Reasoning is a PLAN entitlement, not a minute. Tying it to `can_start`
    -- charged a paying Pro customer twice for the same exhaustion: no audio
    -- AND no reasoning, then sold the plan she already had.
    can_reason := plan_usable and coalesce((plan.limits ->> 'clinical_reasoning')::int, 0) > 0;
  end if;

  -- Who may buy a pack (a commercial rule, enforced again server-side in
  -- startPackCheckout): only a paid plan that already includes minutes. Open
  -- to Gratuito it would become a cheaper substitute for the subscription
  -- rather than a top-up for someone who ran out.
  -- 0111: not during the provisional window — nothing has been paid yet.
  pack_purchasable := plan_usable and plan_minutes > 0 and not coalesce(plan.is_free, true) and not provisional;

  if suspended then
    reason := 'suspended';
  elsif sub.status = 'past_due' and not in_grace and not can_start then
    reason := 'past_due_blocked';
  elsif can_start then
    reason := case
      when in_grace then 'past_due_grace'
      -- Working on minutes she bought separately: worth saying, because it is
      -- a balance that does not come back at the next renewal.
      when not cycle_can_start then 'pack_only'
      else 'ok'
    end;
  -- 0111: the window closed and the PIX was never confirmed. What resolves it
  -- is finishing the payment — never a trial.
  elsif pix_pending and not provisional then
    reason := 'payment_unconfirmed';
  elsif trial_available then
    reason := 'trial_not_started';
  elsif src = 'trial' then
    reason := 'trial_over';
  elsif src = 'plan' then
    reason := 'cycle_exhausted';
  else
    reason := 'no_plan';
  end if;

  return jsonb_build_object(
    'source', src,
    'plan_slug', plan.slug,
    'plan_name', plan.name,
    'suspended', suspended,
    -- `minutes_limit` / `minutes_used` / `percent` stay the CYCLE's, which is
    -- what the 80/95/100% alerts are about; the pack pool is reported beside
    -- them, never folded into them.
    'minutes_limit', limit_minutes,
    'minutes_used', used_minutes,
    'cycle_minutes_remaining', cycle_remaining,
    'cycle_expired', cycle_expired,
    'pack_minutes_remaining', pack_minutes_left,
    -- What she can actually still record, which is the sum.
    'minutes_remaining', cycle_remaining + pack_minutes_left,
    'percent', percent,
    'window_start', window_start,
    'window_end', window_end,
    'trial_active', src = 'trial' and cycle_can_start,
    'trial_ends_at', trial.ends_at,
    'trial_available', trial_available,
    'can_start', can_start,
    'clinical_reasoning', can_reason,
    'reason', reason,
    'past_due', sub.status = 'past_due',
    -- Separate from `reason` on purpose: a past_due workspace with a purchased
    -- pack still records, so `reason` says 'pack_only' and the dunning surface
    -- would disappear exactly for the person who has an unpaid invoice.
    'dunning', sub.status = 'past_due' and not coalesce(plan.is_free, true),
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'pack_purchasable', pack_purchasable,
    -- 0111
    'provisional', provisional,
    'provisional_until', case when provisional then pix_sub.provisional_until else null end,
    'payment_pending', pix_pending,
    'pending_plan_slug', case when pix_pending then (select p.slug from public.plans p where p.id = pix_sub.plan_id) else null end
  );
end;
$$;
