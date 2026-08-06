-- ============================================================
-- 0073_admin_processing_failures: a superadmin read of AI-pipeline failures.
--
-- When a professional reports "the recording won't process", the real cause is
-- already persisted — recordings.failure_stage/error_code (WHERE it broke and a
-- coded reason) and, crucially, transcriptions.error (the RAW provider message:
-- model unavailable, quota, bad key). But those tables are org-scoped by RLS, so
-- an operator cannot read another workspace's rows from the client.
--
-- This SECURITY DEFINER function aggregates the failures ACROSS tenants for the
-- /admin/audit console. Same pattern and gate as admin_metrics (0010): callable
-- only by a superadmin; it raises otherwise. Read-only.
-- ============================================================

create or replace function public.admin_processing_failures(limit_count integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'superadmin only';
  end if;

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
  into result
  from (
    select
      r.id            as recording_id,
      r.created_at,
      r.status,
      r.failure_stage,
      r.error_code,
      r.mode,
      r.captured_on,
      r.consultation_id,
      r.org_id,
      o.name          as org_name,
      p.full_name     as patient_name,
      t.status        as transcription_status,
      -- The raw provider message — the detail an operator cannot see anywhere
      -- else without the professional's own account.
      t.error         as provider_error
    from public.recordings r
    left join public.transcriptions t on t.id = r.transcription_id
    left join public.organizations o on o.id = r.org_id
    left join public.patients p on p.id = r.patient_id
    where r.status = 'failed'
    order by r.created_at desc
    limit greatest(1, least(coalesce(limit_count, 100), 500))
  ) f;

  return result;
end;
$$;

revoke all on function public.admin_processing_failures(integer) from public, anon;
grant execute on function public.admin_processing_failures(integer) to authenticated;
