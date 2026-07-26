-- ============================================================
-- 0052_ga_attribution
-- Adds the GA4 client id to the ad-attribution row (0051). Same idea as the
-- Meta _fbp/_fbc signals: the browserless Purchase (fired from the webhook)
-- has no _ga cookie, so we stash the client id captured at checkout and reuse
-- it to stitch the GA4 Measurement Protocol purchase to the web session.
-- Service-role only; cascades with the row on org deletion.
-- ============================================================

alter table public.meta_attribution
  add column if not exists ga_client_id text;
