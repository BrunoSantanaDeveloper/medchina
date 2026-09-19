-- ============================================================
-- 0105_workspace_deletion_guard: erasing a practice is not a REST call.
--
-- `organizations_delete_owner` (0000, inherited from the template) let any
-- workspace owner run
--
--     DELETE /rest/v1/organizations?id=eq.<her workspace>
--
-- and take her whole practice down from the browser. No screen in the product
-- ever offered it — there is no button, no copy, not one call in the code —
-- but the API answered anyway, and what it did was worse than deleting:
--
--   * `record_versions` (0005) carries `org_id` with NO foreign key, so every
--     snapshot the versioning trigger ever wrote — whole patients, whole
--     consultations, whole anamnesis answers — SURVIVED the cascade. The
--     practice looked erased and its charts were still in the database,
--     verbatim;
--   * every stored file (audio, issued PDFs, imports, exports) stayed in
--     Storage, now orphaned and unreachable, because SQL cannot delete them
--     (`protect_objects_delete`);
--   * nothing was audited: no actor, no reason, no counts — the one act that
--     most needs to be attributable left no trace at all;
--   * and for any practice with issued documents or a QR consent session it
--     did not even work: the NO ACTION / RESTRICT references (0101) abort the
--     cascade half-way, so she got a raw constraint name instead of an answer.
--
-- Erasure already has a correct path — `admin_delete_account` (0099/0101):
-- holders before held, history purged, files listed for the Storage API,
-- provider subscription cancelled first, audited with counts. It is operator
-- mediated on purpose, because deleting a practice also deletes the clinical
-- records of people who are not in the room.
--
-- So the policy goes, and a trigger stands behind it: a DELETE policy is one
-- careless migration away from coming back, and the fence should not depend
-- on nobody ever writing that migration. A session with no JWT (service role,
-- a migration, psql) is still allowed — that is the operational path, and the
-- superadmin RPC runs with the operator's own session, which is checked here
-- rather than trusted.
--
-- What the professional gets instead: her full export (0081) whenever she
-- wants it, and a support channel that reaches the audited deletion.
-- ============================================================

drop policy if exists "organizations_delete_owner" on public.organizations;

create or replace function public.guard_organization_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT at all: the service role, a migration, psql. The operational path,
  -- and the only way to clean up after a bad direct write.
  if auth.uid() is null then
    return old;
  end if;

  -- The audited console path (0099/0101) runs as the operator's own session.
  -- A support visit is not that session, even when the operator opened it.
  if public.is_superadmin() and not public.is_impersonated() then
    return old;
  end if;

  raise exception 'workspace_delete_not_self_service'
    using errcode = '42501',
          hint = 'Deleting a practice also erases patient records, their change history and every stored file. That runs through the audited path in the platform console (admin_delete_account), never through a direct write.';
end;
$$;

comment on function public.guard_organization_delete() is
  'Refuses any workspace deletion that is not the audited path: a session with no JWT (service role/migration) or a superadmin outside a support visit.';

drop trigger if exists guard_organization_delete on public.organizations;
create trigger guard_organization_delete
  before delete on public.organizations
  for each row execute function public.guard_organization_delete();
