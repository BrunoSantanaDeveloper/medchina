-- Supabase may grant newly created public functions directly to its API roles.
-- Revoking only from PostgreSQL's PUBLIC pseudo-role is therefore insufficient
-- for worker RPCs. Keep these functions callable exclusively by the trusted
-- service client (and the database owner).

revoke all on function public.heartbeat_recording_processing(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.replace_draft_hypotheses(uuid, bigint, jsonb, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.save_generated_consultation_plan(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, text, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.reserve_document_version(uuid, text, text, jsonb, text, uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_recording_status_notification(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_recording_status_notification(uuid, uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.claim_billing_operation(uuid, uuid, text, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_billing_operation(uuid, uuid, boolean, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.complete_checkout_billing_operation(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_billing_webhook_event(text, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_billing_webhook_event(uuid, uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.complete_retention_audio_deletion(uuid, text)
  from public, anon, authenticated;

grant execute on function public.heartbeat_recording_processing(uuid, uuid) to service_role;
grant execute on function public.replace_draft_hypotheses(uuid, bigint, jsonb, text, text, uuid) to service_role;
grant execute on function public.save_generated_consultation_plan(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, text, text, uuid, boolean) to service_role;
grant execute on function public.reserve_document_version(uuid, text, text, jsonb, text, uuid, text, text, uuid, text, uuid) to service_role;
grant execute on function public.claim_recording_status_notification(uuid, text) to service_role;
grant execute on function public.complete_recording_status_notification(uuid, uuid, boolean, text) to service_role;
grant execute on function public.claim_billing_operation(uuid, uuid, text, uuid, text, uuid, uuid) to service_role;
grant execute on function public.complete_billing_operation(uuid, uuid, boolean, jsonb, text) to service_role;
grant execute on function public.complete_checkout_billing_operation(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.claim_billing_webhook_event(text, text, text) to service_role;
grant execute on function public.complete_billing_webhook_event(uuid, uuid, boolean, text) to service_role;
grant execute on function public.complete_retention_audio_deletion(uuid, text) to service_role;

