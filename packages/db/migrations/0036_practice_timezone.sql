-- ============================================================
-- 0036_practice_timezone: one authoritative IANA timezone per practice.
-- Clinical timestamps stay in UTC; scheduling and issued documents use this
-- setting at the presentation boundary.
-- ============================================================

alter table public.organizations
  add column if not exists timezone text not null default 'America/Sao_Paulo';

create or replace function public.validate_organization_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.timezone := nullif(btrim(new.timezone), '');
  if new.timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_validate_timezone on public.organizations;
create trigger organizations_validate_timezone
  before insert or update of timezone on public.organizations
  for each row execute function public.validate_organization_timezone();

create or replace function public.update_practice_settings(
  target_org uuid,
  target_name text,
  target_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := nullif(btrim(target_name), '');
  normalized_timezone text := nullif(btrim(target_timezone), '');
  previous_org public.organizations%rowtype;
  updated_org public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if target_org is null
     or normalized_name is null
     or char_length(normalized_name) < 3
     or char_length(normalized_name) > 120 then
    raise exception using errcode = '22023', message = 'invalid_practice_name';
  end if;
  if normalized_timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
     ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;

  select o.* into previous_org
  from public.organizations o
  where o.id = target_org
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  update public.organizations
     set name = normalized_name,
         timezone = normalized_timezone
   where id = target_org
     and (name is distinct from normalized_name or timezone is distinct from normalized_timezone)
   returning * into updated_org;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'code', 'unchanged',
      'id', previous_org.id,
      'name', previous_org.name,
      'timezone', previous_org.timezone
    );
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'org.settings.updated',
    'organization',
    target_org::text,
    jsonb_build_object(
      'nameChanged', previous_org.name is distinct from updated_org.name,
      'previousName', previous_org.name,
      'name', updated_org.name,
      'timezoneChanged', previous_org.timezone is distinct from updated_org.timezone,
      'previousTimezone', previous_org.timezone,
      'timezone', updated_org.timezone
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'updated',
    'id', updated_org.id,
    'name', updated_org.name,
    'timezone', updated_org.timezone
  );
end;
$$;

revoke all on function public.update_practice_settings(uuid, text, text) from public;
grant execute on function public.update_practice_settings(uuid, text, text) to authenticated;
