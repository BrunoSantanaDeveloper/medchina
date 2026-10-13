-- ============================================================
-- 0123_whatsapp_reminder_template
--
-- The reminder message becomes HERS.
--
-- Every WhatsApp path in this product is a handoff: the app prepares the text
-- and the professional presses send from her own number (no Meta Cloud API,
-- no template approval, no per-message cost). That makes the wording a problem
-- of authorship, not of plumbing — until now a sentence written by us went out
-- under her name, to her patients, with no way to change it short of editing
-- it by hand in WhatsApp for every single patient of the day.
--
-- So the template is stored on the profile, next to the rest of how she works
-- (`practice_modalities`, 0119's free list, `practice_areas`):
--
--   * NULL means "use the product default" — which is also what clearing the
--     field means. There is no such thing as an empty reminder: a blank value
--     restores the original copy, localized, rather than sending nothing.
--   * The text carries fixed, locale-neutral tokens ({name}, {date}, {time}).
--     They are substituted in the client by `lib/whatsapp-template.ts`, never
--     by an ICU formatter — this is free text a person typed, and an unknown
--     placeholder must survive to her preview instead of throwing.
--
-- Deliberately NOT validated for content here. The database checks length and
-- nothing else: what a practitioner says to her own patient is not ours to
-- approve, and the clinical-safety rules that bound AI output do not apply to
-- a sentence she writes and sends herself.
-- ============================================================

-- ---------- The column ----------

alter table public.profiles
  add column if not exists whatsapp_reminder_template text;

comment on column public.profiles.whatsapp_reminder_template is
  'Her own appointment-reminder message, with {name}/{date}/{time} tokens. NULL = use the localized product default.';

-- Mirrors WHATSAPP_TEMPLATE_MAX in apps/web/src/lib/whatsapp-template.ts: a
-- wa.me link carries the message percent-encoded in the URL, so the ceiling is
-- the link's, not the database's.
alter table public.profiles
  drop constraint if exists profiles_whatsapp_reminder_template_length;

alter table public.profiles
  add constraint profiles_whatsapp_reminder_template_length
  check (whatsapp_reminder_template is null or char_length(whatsapp_reminder_template) between 1 and 700);

-- ---------- Saving it ----------

create or replace function public.update_whatsapp_reminder_template(target_template text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_template text;
  actor_org uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  -- An operator inside a support session must not rewrite what goes out under
  -- her name to her patients (same discipline as 0119).
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  normalized_template := nullif(btrim(coalesce(target_template, '')), '');

  if normalized_template is not null and char_length(normalized_template) > 700 then
    return jsonb_build_object('ok', false, 'code', 'template_too_long');
  end if;

  update public.profiles
     set whatsapp_reminder_template = normalized_template,
         updated_at = now()
   where id = auth.uid();

  select m.org_id into actor_org
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;

  -- The FACT, never the text: the audit trail is read by more people than the
  -- profile is, and the wording she chose for her patients is hers to show.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_org,
    auth.uid(),
    'practice.whatsapp_reminder_template.updated',
    'profile',
    auth.uid()::text,
    jsonb_build_object(
      'customised', normalized_template is not null,
      'length', coalesce(char_length(normalized_template), 0)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'updated',
    'whatsapp_reminder_template', to_jsonb(normalized_template)
  );
end;
$$;

revoke all on function public.update_whatsapp_reminder_template(text) from public;
grant execute on function public.update_whatsapp_reminder_template(text) to authenticated;
