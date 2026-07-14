-- ============================================================
-- 0019_slug_accents: org slugs must survive Portuguese accents.
--
-- The 0000 bootstrap slugified with [^a-zA-Z0-9]+ → every accented
-- letter became a dash ("Clínica Acupuntura & Saúde" →
-- "cl-nica-acupuntura-sa-de"). MedChina is a pt-BR product, so almost
-- every practice name hits this. slugify() transliterates the Latin-1
-- letters first, then collapses the rest.
-- ============================================================

create or replace function public.slugify(value text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  -- lower() runs first, so only lower-case accents need mapping. The two
  -- translate() arguments MUST stay the same length (79 chars) — a mismatch
  -- silently shifts every mapping after the offending character.
  select trim(
    both '-' from
    regexp_replace(
      translate(
        lower(value),
        'áàâãäåāăąçćčĉċďđéèêëēĕėęěğĝġģíìîïĩīĭįıĺľłļñńňņóòôõöøōŏőŕřšśşŝťţúùûüũūŭůűųýÿŷžźż',
        'aaaaaaaaacccccddeeeeeeeeeggggiiiiiiiiillllnnnnooooooooorrssssttuuuuuuuuuuyyyzzz'
      ),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

comment on function public.slugify(text) is
  'Accent-aware slug: transliterates Latin-1 letters before collapsing separators. Used for organization slugs.';

-- Recreate the signup bootstrap using slugify (rest of the body unchanged).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company text;
  company_slug text;
  new_org uuid;
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  company := nullif(trim(new.raw_user_meta_data ->> 'company'), '');
  if company is not null then
    -- Fall back to "org" when the name is all punctuation/emoji, so the
    -- slug never degenerates to just the id suffix.
    company_slug := nullif(public.slugify(company), '');
    insert into public.organizations (name, slug, created_by)
    values (
      company,
      coalesce(company_slug, 'org') || '-' || substr(new.id::text, 1, 8),
      new.id
    )
    returning id into new_org;

    insert into public.memberships (org_id, user_id, role)
    values (new_org, new.id, 'owner');
  end if;

  return new;
end;
$$;
