-- ============================================================
-- 0059_verify_page_privacy
--
-- The public verification page (/verify/[code]) is the ONE surface a patient
-- reaches from the QR printed on a therapeutic plan. It was returning the
-- document's free-text `title`, which the issuing route composes as
-- "Plano terapêutico — <patient full name>". That publishes an identified
-- person's link to a health treatment to anyone holding the code — sensitive
-- personal data under LGPD Art. 11, and against PRD §9.8, which asks for a
-- MINIMAL public page: status, code, issuer, date.
--
-- Two changes, and the first is what matters:
--   1) verify_document stops returning `title` at all. Fixing only the route
--      that composes new titles would leave every document already issued
--      exposed; removing the column protects them retroactively. The page now
--      labels the document from its `kind`, which is a type, not a person.
--   2) It reports whether a revoked document was SUPERSEDED by a newer version
--      (documents.parent_id) so the page can say "there is a newer version of
--      this document" instead of the alarming "revoked" for what is really a
--      routine reissue.
--
-- The patient's name stays in the PDF itself, which is private (signed URLs,
-- never public), exactly where a clinical document should carry it.
-- ============================================================

drop function if exists public.verify_document(text);

create or replace function public.verify_document(code text)
returns table (
  kind text,
  status text,
  version integer,
  issued_at timestamptz,
  content_hash text,
  organization_name text,
  superseded boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    d.kind,
    d.status,
    d.version,
    d.issued_at,
    d.content_hash,
    o.name as organization_name,
    exists (
      select 1 from public.documents newer
      where newer.parent_id = d.id and newer.status = 'issued'
    ) as superseded
  from public.documents d
  join public.organizations o on o.id = d.org_id
  where d.verify_code = code and d.status in ('issued', 'revoked');
$$;

revoke all on function public.verify_document(text) from public;
grant execute on function public.verify_document(text) to anon, authenticated;

comment on function public.verify_document(text) is
  'Public authenticity check. Deliberately PHI-thin: no title, no patient, no clinical content — status, type, version, issuer and hash only (PRD §9.8).';
