-- ============================================================
-- 0043_library_usage_alerts: the 80/95/100% consumption alerts
-- (PRD §5.8) gain a second meter — the clinical library's monthly
-- message quota — so both product currencies (audio minutes and
-- library messages) warn the professional the same way.
--
-- `meter` defaults to 'audio' so every existing row and the audio
-- pipeline's inserts keep meaning exactly what they meant.
-- ============================================================

alter table public.usage_alerts
  add column meter text not null default 'audio'
    check (meter in ('audio', 'library_messages'));

-- The idempotency key now includes the meter: an 80% audio alert must
-- not swallow the 80% library alert for the same window.
alter table public.usage_alerts
  drop constraint usage_alerts_org_id_window_start_threshold_key;

alter table public.usage_alerts
  add constraint usage_alerts_org_meter_window_threshold_key
    unique (org_id, meter, window_start, threshold);
