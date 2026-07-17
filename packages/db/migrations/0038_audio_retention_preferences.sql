-- ============================================================
-- 0038_audio_retention_preferences: each practice chooses how long source
-- audio is retained. The chosen policy is snapshotted on the transcription so
-- changing a preference never rewrites the retention contract of old audio.
-- ============================================================

alter table public.organizations
  add column if not exists audio_retention text not null default 'after_validation';

alter table public.organizations
  drop constraint if exists organizations_audio_retention_check;
alter table public.organizations
  add constraint organizations_audio_retention_check
    check (audio_retention in ('after_validation', 'thirty_days', 'manual')) not valid;
alter table public.organizations validate constraint organizations_audio_retention_check;

alter table public.transcriptions
  add column if not exists retention_policy text not null default 'after_validation',
  add column if not exists retain_until timestamptz;

alter table public.transcriptions
  drop constraint if exists transcriptions_retention_policy_check,
  drop constraint if exists transcriptions_retain_until_check;
alter table public.transcriptions
  add constraint transcriptions_retention_policy_check
    check (retention_policy in ('after_validation', 'thirty_days', 'manual')) not valid,
  add constraint transcriptions_retain_until_check
    check (
      (retention_policy = 'thirty_days' and retain_until is not null)
      or (retention_policy <> 'thirty_days' and retain_until is null)
    ) not valid;

update public.transcriptions
set retention_policy = case when delete_audio_after then 'after_validation' else 'manual' end,
    retain_until = null;

alter table public.transcriptions
  validate constraint transcriptions_retention_policy_check,
  validate constraint transcriptions_retain_until_check;

create index if not exists transcriptions_retention_due_idx
  on public.transcriptions (retain_until)
  where retention_policy = 'thirty_days'
    and validated_at is not null
    and audio_path is not null;

create or replace function public.snapshot_transcription_retention()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  selected_policy text;
begin
  select o.audio_retention into selected_policy
  from public.organizations o
  where o.id = new.org_id;

  selected_policy := coalesce(selected_policy, 'after_validation');
  new.retention_policy := selected_policy;
  new.retain_until := case when selected_policy = 'thirty_days' then now() + interval '30 days' else null end;
  new.delete_audio_after := selected_policy = 'after_validation';
  return new;
end;
$$;

drop trigger if exists transcriptions_snapshot_retention on public.transcriptions;
create trigger transcriptions_snapshot_retention
  before insert on public.transcriptions
  for each row execute function public.snapshot_transcription_retention();

create or replace function public.set_audio_retention_policy(
  target_org uuid,
  target_policy text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_policy text := nullif(btrim(target_policy), '');
  previous_policy text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if normalized_policy is null or normalized_policy not in ('after_validation', 'thirty_days', 'manual') then
    raise exception using errcode = '22023', message = 'invalid_audio_retention';
  end if;

  select o.audio_retention into previous_policy
  from public.organizations o
  where o.id = target_org
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  if previous_policy = normalized_policy then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'audioRetention', previous_policy);
  end if;

  update public.organizations
  set audio_retention = normalized_policy
  where id = target_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'org.audio_retention.updated',
    'organization',
    target_org::text,
    jsonb_build_object('previousPolicy', previous_policy, 'policy', normalized_policy)
  );

  return jsonb_build_object('ok', true, 'code', 'updated', 'audioRetention', normalized_policy);
end;
$$;

-- Storage is deleted first. This fenced completion validates that the exact
-- snapshotted object is gone and updates the recording + transcription in one
-- database transaction. It is intentionally service-role only.
create or replace function public.complete_retention_audio_deletion(
  target_transcription uuid,
  expected_audio_path text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  transcription_row public.transcriptions%rowtype;
  recording_row public.recordings%rowtype;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select t.* into transcription_row
  from public.transcriptions t
  where t.id = target_transcription
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  if transcription_row.audio_path is null and transcription_row.audio_deleted_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_deleted');
  end if;
  if transcription_row.retention_policy <> 'thirty_days'
     or transcription_row.validated_at is null
     or transcription_row.retain_until is null
     or transcription_row.retain_until > now() then
    return jsonb_build_object('ok', false, 'code', 'retention_not_due');
  end if;
  if transcription_row.audio_path is distinct from expected_audio_path then
    return jsonb_build_object('ok', false, 'code', 'stale_audio_path');
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'transcriptions' and o.name = expected_audio_path
  ) then
    return jsonb_build_object('ok', false, 'code', 'audio_deletion_failed');
  end if;

  select r.* into recording_row
  from public.recordings r
  where r.transcription_id = target_transcription
  for update;

  update public.transcriptions
  set audio_path = null,
      audio_deleted_at = coalesce(audio_deleted_at, now()),
      deletion_error = null
  where id = target_transcription;

  if recording_row.id is not null then
    update public.recordings
    set audio_path = null,
        audio_deleted_at = coalesce(audio_deleted_at, now()),
        audio_deletion_requested_at = coalesce(audio_deletion_requested_at, now())
    where id = recording_row.id;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    transcription_row.org_id,
    null,
    'recording.audio.retention_deleted',
    'transcription',
    target_transcription::text,
    jsonb_build_object('policy', transcription_row.retention_policy, 'retainUntil', transcription_row.retain_until)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'audio_deleted',
    'transcriptionId', target_transcription,
    'recordingId', recording_row.id
  );
end;
$$;

revoke all on function public.set_audio_retention_policy(uuid, text) from public;
grant execute on function public.set_audio_retention_policy(uuid, text) to authenticated;

revoke all on function public.complete_retention_audio_deletion(uuid, text) from public;
grant execute on function public.complete_retention_audio_deletion(uuid, text) to service_role;
