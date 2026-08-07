-- ============================================================
-- 0078_practice_modalities_settings
--
-- Lets the professional edit her scope of practice AFTER onboarding.
--
-- `profiles.practice_modalities` (0050) is declared once in the activation
-- step and then becomes unreachable: the form is embedded in
-- /primeiros-passos behind `!hasPracticeContext`, so it disappears the moment
-- the timezone is confirmed. Someone who starts practising cupping has
-- nowhere to say so — and the scope drives what the therapeutic plan may
-- propose, so a stale declaration silently narrows her own tool.
--
-- Why an RPC instead of the direct `profiles` update that ProfileCard uses:
--
--   1. AUDIT — every mutation records an event (CLAUDE.md); a browser update
--      records nothing.
--   2. ONE validator — the slug list and the normalisation live in SQL, next
--      to `complete_practice_context`, instead of being re-implemented in a
--      second client that can drift from it.
--   3. IMPERSONATION FENCE — `profiles` is NOT among the tables fenced by
--      0057, so a support session could rewrite her scope through PostgREST.
--      A security-definer RPC is where that refusal can live.
--
-- Deliberately does NOT touch `organizations.timezone_confirmed_at`: that
-- stamp is the activation predicate for the practice-context step
-- (lib/onboarding.ts), and editing modalities is not confirming a timezone.
-- ============================================================

create or replace function public.update_practice_modalities(target_modalities text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_modalities text[];
  actor_org uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  -- Support sees the account; it does not get to redefine what she practises.
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- Same normalisation as complete_practice_context (0050): trim, lower,
  -- distinct, sorted — so the stored array is comparable and order-stable.
  select coalesce(array_agg(value order by value), '{}'::text[])
    into normalized_modalities
  from (
    select distinct lower(btrim(modality)) as value
    from unnest(coalesce(target_modalities, '{}'::text[])) as modality
    where nullif(btrim(modality), '') is not null
  ) normalized;

  if exists (
    select 1
    from unnest(normalized_modalities) as modality
    where modality <> all (
      array['acupuncture', 'diet', 'moxibustion', 'auriculotherapy', 'cupping']::text[]
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_modality');
  end if;

  update public.profiles
     set practice_modalities = normalized_modalities,
         updated_at = now()
   where id = auth.uid();

  -- An empty declaration is legitimate (it means "no restriction"), so the
  -- audit records the COUNT, never the list — the same privacy discipline as
  -- 0050's practice.context.completed.
  select m.org_id into actor_org
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_org,
    auth.uid(),
    'practice.modalities.updated',
    'profile',
    auth.uid()::text,
    jsonb_build_object('modalityCount', cardinality(normalized_modalities))
  );

  return jsonb_build_object('ok', true, 'code', 'updated', 'practice_modalities', normalized_modalities);
end;
$$;

revoke all on function public.update_practice_modalities(text[]) from public, anon;
grant execute on function public.update_practice_modalities(text[]) to authenticated;

comment on function public.update_practice_modalities(text[]) is
  'Updates the caller''s own scope of practice from /settings. Audited, validated against the five product modalities, and refused during a support impersonation. Never touches the organization or its timezone confirmation.';
