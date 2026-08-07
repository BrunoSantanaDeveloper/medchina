/**
 * The professional's receituário (prescription) — migration 0074.
 *
 * The AI never prescribes (PRD §10/§16): a prescription is authored and signed
 * by the professional. Two kinds — a Chinese herbal FORMULA ('herbal') and a
 * free structured script ('generic'). Shared types + normalization used by the
 * panel today and by the signed-PDF renderer/route in phase 2.
 */
export type PrescriptionKind = "herbal" | "generic";
export type PrescriptionStatus = "draft" | "validated";

export const PRESCRIPTION_KINDS: PrescriptionKind[] = ["herbal", "generic"];

/** One line of the prescription: a herb/component or a free item. */
export interface PrescriptionItem {
  name: string;
  amount: string;
  notes: string;
}

export interface Prescription {
  id: string;
  kind: PrescriptionKind;
  title: string;
  items: PrescriptionItem[];
  posology: string;
  preparation: string;
  notes: string;
  status: PrescriptionStatus;
  validatedAt: string | null;
  updatedAt: string;
}

export function normalizeItems(raw: unknown): PrescriptionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return {
        name: String(record.name ?? "").trim(),
        amount: String(record.amount ?? "").trim(),
        notes: String(record.notes ?? "").trim(),
      };
    })
    .filter((item) => item.name || item.amount || item.notes);
}

/** Trim and drop empty lines before persisting. */
export function itemsForSave(items: PrescriptionItem[]): PrescriptionItem[] {
  return items
    .map((item) => ({ name: item.name.trim(), amount: item.amount.trim(), notes: item.notes.trim() }))
    .filter((item) => item.name || item.amount || item.notes);
}

export function emptyItem(): PrescriptionItem {
  return { name: "", amount: "", notes: "" };
}
