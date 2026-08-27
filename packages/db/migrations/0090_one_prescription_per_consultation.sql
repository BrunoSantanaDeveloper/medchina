-- ============================================================
-- 0090_one_prescription_per_consultation
--
-- The receituário is ONE per consultation — the professional writes a single
-- prescription for the appointment, and the UI stopped offering "add" once one
-- exists. A rule that lives only in the interface is not a rule: two tabs, a
-- double click, or any future caller would still create a second row, and the
-- card would silently show one of them while the PDF was issued from the other.
--
-- Safe to apply as-is: verified before writing this migration that no
-- consultation currently holds more than one prescription.
-- ============================================================

create unique index if not exists consultation_prescriptions_one_per_consultation
  on public.consultation_prescriptions (consultation_id);

comment on index public.consultation_prescriptions_one_per_consultation is
  'One receituário per consultation (PRD §9.8): the card shows a single prescription and issues its PDF from it.';
