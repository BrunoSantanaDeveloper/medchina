import { strToU8, zipSync } from "fflate";

import { loadPatientExport, PATIENT_EXPORT_FORMAT, PATIENT_EXPORT_VERSION } from "@/lib/patient-export";
import { normalizePatientName } from "@/lib/patients";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The whole practice, packaged (docs/IMPORT-EXPORT.md §7, item 6).
 *
 * A ZIP with one JSON per patient rather than one enormous file: she can open
 * it, find a name, and hand a single chart to whoever needs it. The manifest
 * carries what the archive is and what it is NOT, inside the archive — nobody
 * reading it in two years can ask us.
 *
 * Runs with the SERVICE client (the job has no session), so every query is
 * scoped by `org_id` here instead of by RLS. That is the one thing to keep
 * true when editing this file: the patient list is the boundary, and every
 * chart loaded below comes from it.
 */

export const ACCOUNT_EXPORT_FORMAT = "medchina.account-export";
export const ACCOUNT_EXPORT_VERSION = 1;

export type AccountArchive = {
  bytes: Uint8Array;
  patientCount: number;
};

export type ArchiveNotes = {
  /** One line stating what the archive does not contain, in her language. */
  scopeNote: string;
  readmeTitle: string;
};

/**
 * Unique, readable entry names even when two patients share one: the name to
 * find it by, a short id to keep it unambiguous. No date — the archive already
 * carries one, and repeating it in 400 file names only makes them harder to
 * read.
 */
function entryName(fullName: string, id: string): string {
  const slug = normalizePatientName(fullName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `pacientes/${slug || "paciente"}-${id.slice(0, 8)}.json`;
}

export async function buildAccountArchive(
  supabase: SupabaseClient,
  orgId: string,
  notes: ArchiveNotes,
  now = new Date(),
): Promise<AccountArchive> {
  const { data: organization } = await supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
  const { data: patients, error } = await supabase
    .from("patients")
    .select("id, full_name")
    .eq("org_id", orgId)
    .order("full_name");

  if (error) throw new Error("account_export_patients_failed");

  const files: Record<string, Uint8Array> = {};
  const index: { id: string; fullName: string; file: string }[] = [];

  for (const patient of patients ?? []) {
    const record = await loadPatientExport(supabase, patient.id as string);
    if (!record) continue;
    const file = entryName(patient.full_name as string, patient.id as string);
    files[file] = strToU8(JSON.stringify(record, null, 2));
    index.push({ id: patient.id as string, fullName: patient.full_name as string, file });
  }

  const manifest = {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    patientExportFormat: { format: PATIENT_EXPORT_FORMAT, version: PATIENT_EXPORT_VERSION },
    generatedAt: now.toISOString(),
    organization: { id: orgId, name: (organization?.name as string | null) ?? null },
    patientCount: index.length,
    patients: index,
    scopeNote: notes.scopeNote,
  };

  files["conta.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["LEIA-ME.txt"] = strToU8(
    [notes.readmeTitle, "", notes.scopeNote, "", `${ACCOUNT_EXPORT_FORMAT} v${ACCOUNT_EXPORT_VERSION}`].join("\n"),
  );

  return { bytes: zipSync(files, { level: 6 }), patientCount: index.length };
}

/** `medchina-conta-2026-08-07.zip` — recognizable a year later. */
export function accountArchiveName(now = new Date()): string {
  return `medchina-conta-${now.toISOString().slice(0, 10)}.zip`;
}
