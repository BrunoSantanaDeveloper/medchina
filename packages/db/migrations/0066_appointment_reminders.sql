-- ============================================================
-- 0066_appointment_reminders
--
-- Appointment reminders, the way this product can actually send them.
--
-- No-show is the biggest recurring loss in a solo practice, and the agenda
-- already MEASURES it (cancellation_category = 'no_show', migration 0041)
-- without offering the one lever that reduces it. Automated WhatsApp is off
-- the table — the Meta Cloud API needs business verification, template
-- approval and charges per message — so the reminder is a HANDOFF: the app
-- prepares one `wa.me` message per patient and the professional presses send
-- from her own number.
--
-- What that means for this column, and it is the whole design decision:
--
--   `reminder_marked_at` records that SHE MARKED the reminder as sent. It is
--   NOT proof of delivery, and it must never be presented as one — the app
--   hands off to WhatsApp and never learns what happened there. Naming it
--   `reminder_sent_at` would have invited every later reader (a report, a
--   no-show analysis, a support conversation) to treat a click as a delivery.
--
-- It exists so the professional does not lose her place halfway through a
-- list of eight patients, and so reopening the dialog tomorrow still shows
-- what she already did. She can unmark it — the only source of truth here is
-- her own memory of having pressed send.
-- ============================================================

alter table public.consultations
  add column if not exists reminder_marked_at timestamptz,
  add column if not exists reminder_marked_by uuid references public.profiles (id) on delete set null;

comment on column public.consultations.reminder_marked_at is
  'When the professional MARKED the appointment reminder as sent (WhatsApp handoff). Not proof of delivery: the app cannot observe what happens after wa.me opens.';

-- Only the pending ones matter to the query that drives the dialog.
create index if not exists consultations_reminder_pending_idx
  on public.consultations (org_id, scheduled_for)
  where status = 'scheduled' and reminder_marked_at is null;

/**
 * Mark (or unmark) an appointment's reminder.
 *
 * A tiny RPC rather than a direct UPDATE for two reasons: the finalized-record
 * guard (0021/0029) rejects app-level writes to consultations it protects, and
 * the audit trail belongs in the same transaction as the change. Only a
 * SCHEDULED appointment can carry a reminder — reminding someone about a
 * consultation that already happened, or was cancelled, is noise.
 */
create or replace function public.mark_appointment_reminder(
  target_consultation uuid,
  target_marked boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consultation_row public.consultations%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(consultation_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_an_appointment', 'status', consultation_row.status);
  end if;

  update public.consultations
  set reminder_marked_at = case when target_marked then now() else null end,
      reminder_marked_by = case when target_marked then auth.uid() else null end
  where id = target_consultation;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    consultation_row.org_id, auth.uid(),
    case when target_marked then 'appointment.reminder.marked' else 'appointment.reminder.unmarked' end,
    'consultation', consultation_row.id::text,
    jsonb_build_object('channel', 'whatsapp_handoff', 'scheduledFor', consultation_row.scheduled_for)
  );

  return jsonb_build_object('ok', true, 'code', case when target_marked then 'marked' else 'unmarked' end);
end;
$$;

revoke all on function public.mark_appointment_reminder(uuid, boolean) from public, anon;
grant execute on function public.mark_appointment_reminder(uuid, boolean) to authenticated;
