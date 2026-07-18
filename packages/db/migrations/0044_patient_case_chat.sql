-- ============================================================
-- 0044_patient_case_chat: a library conversation can be ABOUT one
-- specific patient (case review, item 2 of the out-of-consultation
-- roadmap). The link is set once at creation by the chat route —
-- explicit UI selection, never inferred from the message text.
--
-- ON DELETE CASCADE on purpose: a case-review conversation CONTAINS
-- the patient's clinical data, so LGPD erasure of the patient must
-- take these conversations with it (same philosophy as the clinical
-- tables in 0021). Conversations without a patient are untouched.
-- ============================================================

alter table public.conversations
  add column patient_id uuid references public.patients (id) on delete cascade;

create index conversations_org_patient_idx
  on public.conversations (org_id, patient_id)
  where patient_id is not null;

comment on column public.conversations.patient_id is
  'Set when the conversation is a case review about one patient (library chat). Cascade: patient erasure removes the conversations that carry their clinical data.';
