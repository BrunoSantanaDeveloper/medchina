import { recordAudit } from "@/lib/audit";
import { onlyDigits } from "@flyee/fields";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PatientOption = {
  id: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
};

export type CreatePatientInput = {
  orgId: string;
  fullName: string;
  birthDate?: string;
  phone?: string;
};

export type PatientResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const normalizePatientName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");

export function findPatientDuplicates(options: PatientOption[], fullName: string): PatientOption[] {
  const normalized = normalizePatientName(fullName);
  if (!normalized) return [];
  return options.filter((option) => normalizePatientName(option.fullName) === normalized);
}

export async function listActivePatientOptions(
  supabase: SupabaseClient,
  orgId: string,
): Promise<PatientResult<PatientOption[]>> {
  const { data, error } = await supabase
    .from("patients")
    .select("id, full_name, birth_date, phone")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("full_name", { ascending: true });

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      fullName: row.full_name as string,
      birthDate: (row.birth_date as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
    })),
  };
}

export async function createQuickPatient(
  supabase: SupabaseClient,
  input: CreatePatientInput,
): Promise<PatientResult<PatientOption>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const { data, error } = await supabase
    .from("patients")
    .insert({
      org_id: input.orgId,
      full_name: fullName,
      birth_date: input.birthDate || null,
      phone: input.phone ? onlyDigits(input.phone) : null,
      created_by: user.id,
    })
    .select("id, full_name, birth_date, phone")
    .single();

  if (error) return { ok: false, error: error.message };

  await recordAudit(supabase, "patient.created", {
    orgId: input.orgId,
    entityType: "patient",
    entityId: data.id as string,
    metadata: { source: "agenda_quick_create" },
  });

  return {
    ok: true,
    data: {
      id: data.id as string,
      fullName: data.full_name as string,
      birthDate: (data.birth_date as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
    },
  };
}
