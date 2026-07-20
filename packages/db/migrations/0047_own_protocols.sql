-- ============================================================
-- 0047_own_protocols: the professional's OWN protocols join the
-- clinical library (fase 5).
--
-- No new table and no new policy: a collection slug is unique PER ORG
-- (`unique nulls not distinct (org_id, slug)`, 0003) and the owner of a
-- workspace may already write its collections and documents. Adding the
-- slug to the assistant's knowledge config is enough — resolveCollectionIds
-- runs under the caller's RLS, so each workspace resolves ITS OWN
-- `meus-protocolos` collection and never sees another's.
--
-- The collection itself is created on demand by the app the first time she
-- saves a protocol (a workspace that never writes one keeps no empty row).
-- ============================================================

update public.assistants
set config = jsonb_set(
  config,
  '{knowledge,collections}',
  (config -> 'knowledge' -> 'collections') || '["meus-protocolos"]'::jsonb
)
where slug = 'biblioteca-mtc'
  and not (config -> 'knowledge' -> 'collections' @> '["meus-protocolos"]'::jsonb);
