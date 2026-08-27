-- ============================================================
-- 0089_org_entitlements_service_role
--
-- Bug encontrado no primeiro teste real do servidor MCP (0088): o gate de
-- tools chama `org_entitlements` com o SERVICE ROLE (não há sessão Supabase —
-- o chamador é um token OAuth nosso), e o guard da função só admitia
-- `is_org_member OR is_superadmin`. Sob service role `auth.uid()` é nulo,
-- a função levantava 'not a member of this organization' e TODA chamada de
-- tool morria em "Não foi possível verificar a assinatura agora".
--
-- As funções irmãs (`org_audio_allowance`, `org_message_allowance`) sempre
-- tiveram o ramo `auth.role() = 'service_role'` no guard — `org_entitlements`
-- nunca precisou dele porque o app a chamava apenas com a sessão da
-- profissional. Esta migração recria a definição vigente (0054) mudando SÓ o
-- guard, alinhando as três.
--
-- Nota: `org_credit_balance` embute `is_org_member` no WHERE e devolve 0 sob
-- service role em vez de errar — inofensivo para o gate MCP, que lê apenas
-- `active` e `limits`.
-- ============================================================

create or replace function public.org_entitlements(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  merged jsonb;
  grace_ends timestamptz;
  in_grace boolean := false;
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

  if not found then
    return jsonb_build_object('active', false, 'reason', 'no_subscription');
  end if;

  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  select p.limits into merged from public.plans p where p.id = sub.plan_id;

  select coalesce(merged || jsonb_object_agg_merged.limits, merged) into merged
  from (
    select public.jsonb_merge_agg(m.limits) as limits
    from public.subscription_modules sm
    join public.modules m on m.id = sm.module_id
    where sm.subscription_id = sub.id and sm.status = 'active'
  ) as jsonb_object_agg_merged
  where jsonb_object_agg_merged.limits is not null;

  return jsonb_build_object(
    'active', (not sub.admin_suspended) and (sub.status in ('trialing', 'active') or in_grace),
    'suspended', sub.admin_suspended,
    'status', sub.status,
    'past_due_grace', in_grace,
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'plan_id', sub.plan_id,
    'limits', coalesce(merged, '{}'::jsonb),
    'credit_balance', public.org_credit_balance(target_org)
  );
end;
$$;

revoke all on function public.org_entitlements(uuid) from public, anon;
grant execute on function public.org_entitlements(uuid) to authenticated, service_role;
