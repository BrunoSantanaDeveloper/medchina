-- ---------------------------------------------------------------------------
-- 0125 — The template's example assistant stops answering
-- ---------------------------------------------------------------------------
-- 0002_ai.sql seeds `product-assistant`: an example instruction set the
-- template expects every derived project to replace or remove. MedChina never
-- did either, and never used it (no conversation ever named it), but it stayed
-- ACTIVE — and /api/ai/chat serves any active assistant to any member:
--
--   * It points at Anthropic. The day ANTHROPIC_API_KEY is set (to run one
--     clinical feature on Claude), it becomes a general-purpose Claude chat
--     with no quota key and no credit cost, open to every workspace.
--   * Until the chat route learned to refuse it, naming it with a `patientId`
--     sent that patient's record to the second processor, outside the clinical
--     library whose provider was chosen for clinical data.
--
-- Turned off, not deleted: a superadmin who wants an in-app product assistant
-- rewrites its instructions in /admin/ai and switches it back on — a decision,
-- instead of a leftover. Only the untouched placeholder is matched, so an
-- assistant someone already rewrote under this slug keeps running.

update public.assistants
   set is_active = false
 where slug = 'product-assistant'
   and system_prompt like '%template placeholder instruction set%';
