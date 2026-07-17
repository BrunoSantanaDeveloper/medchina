/**
 * Temporary product-verify seed: creates an isolated test workspace with REAL
 * consultations (through the app's own RPCs) so the agenda journey can be
 * walked end-to-end. Idempotent: re-running wipes the seeded patients (cascade
 * removes their consultations) and seeds again. Delete after verification.
 *
 * Run from the repo root: node_modules/.bin/tsx scripts/verify-agenda-seed.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(import.meta.dirname, "..");

function loadEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env) && value) process.env[m[1]] = value;
  }
}
loadEnv(resolve(ROOT, "apps/web/.env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !anonKey || !serviceKey) {
  console.error("Missing Supabase env.");
  process.exit(1);
}

const EMAIL = "verify-agenda@medchina.dev";
const PASSWORD = "Verify!Agenda2026#mc";

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---------- ensure test user ----------

let userId: string | undefined;
{
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  userId = data.users.find((u) => u.email === EMAIL)?.id;
}
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Dra. Verificação", company: "Consultório Verificação" },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  userId = data.user!.id;
  console.log(`Created test user ${EMAIL}`);
} else {
  const { error } = await admin.auth.admin.updateUserById(userId, { password: PASSWORD });
  if (error) throw new Error(`updateUser: ${error.message}`);
  console.log(`Reusing test user ${EMAIL}`);
}

// ---------- sign in as the real user (RLS applies, real code paths) ----------

const app = createClient(url, anonKey, { auth: { persistSession: false } });
{
  const { error } = await app.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error(`signIn: ${error.message}`);
}

const { data: memberships, error: membershipError } = await app.from("memberships").select("org_id").limit(1);
if (membershipError || !memberships?.length) {
  throw new Error(`No workspace for the test user: ${membershipError?.message ?? "no membership"}`);
}
const orgId = memberships[0].org_id as string;
console.log(`Workspace: ${orgId}`);

// ---------- wipe previous seed (patient cascade removes consultations) ----------

{
  const { data: previous } = await admin.from("patients").select("id, full_name").eq("org_id", orgId);
  if (previous?.length) {
    const { error } = await admin
      .from("patients")
      .delete()
      .eq("org_id", orgId)
      .in("id", previous.map((p) => p.id));
    if (error) throw new Error(`wipe patients: ${error.message}`);
    console.log(`Wiped ${previous.length} previous patients (+ consultations by cascade).`);
  }
}

// ---------- patients ----------

async function createPatient(row: Record<string, unknown>): Promise<{ id: string; name: string }> {
  const { data, error } = await app
    .from("patients")
    .insert({ org_id: orgId, ...row })
    .select("id, full_name")
    .single();
  if (error) throw new Error(`create patient: ${error.message}`);
  return { id: data.id as string, name: data.full_name as string };
}

const maria = await createPatient({
  full_name: "Maria Souza Lima",
  birth_date: "1978-04-12",
  phone: "11987654321",
  alerts: [{ label: "Gestante", severity: "high" }],
});
const joao = await createPatient({ full_name: "João Pereira", birth_date: "1990-09-30", phone: "11912340987" });
const ana = await createPatient({ full_name: "Ana Beatriz Castro" });
console.log(`Patients: ${[maria, joao, ana].map((p) => p.name).join(", ")}`);

// ---------- appointments through the real RPCs ----------

type RpcResult = { ok: boolean; code: string; consultationId?: string; status?: string };

async function schedule(
  patientId: string,
  startAt: Date,
  durationMinutes: number,
  note?: string,
): Promise<string> {
  const { data, error } = await app.rpc("save_scheduled_consultation", {
    target_org: orgId,
    target_patient: patientId,
    target_start: startAt.toISOString(),
    target_duration: durationMinutes,
    target_note: note ?? null,
    target_consultation: null,
    force_conflict: false,
  });
  if (error) throw new Error(`save_scheduled_consultation: ${error.message}`);
  const result = data as RpcResult;
  if (!result.ok || !result.consultationId) throw new Error(`schedule failed: ${result.code}`);
  return result.consultationId;
}

const now = new Date();
const at = (minutesFromNow: number) => new Date(now.getTime() + minutesFromNow * 60_000);
const tomorrowAt = (hour: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const inDaysAt = (days: number, hour: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// F: finalized today (45min from now, 30min) — schedule -> start -> finalize.
const finalizedId = await schedule(ana.id, at(45), 30, "Sessão de acompanhamento");
{
  const started = await app.rpc("start_scheduled_consultation", { target_consultation: finalizedId });
  if (started.error || !(started.data as RpcResult).ok) {
    throw new Error(`start (finalize seed): ${started.error?.message ?? (started.data as RpcResult).code}`);
  }
  const { data: row, error } = await app
    .from("consultations")
    .select("clinical_revision")
    .eq("id", finalizedId)
    .single();
  if (error) throw new Error(`read revision: ${error.message}`);
  const finalized = await app.rpc("finalize_consultation", {
    target_consultation: finalizedId,
    expected_revision: row.clinical_revision,
    acknowledged_warnings: [],
  });
  const result = finalized.data as RpcResult;
  if (finalized.error || !result.ok) {
    console.warn(`finalize failed (${finalized.error?.message ?? result.code}) — leaving as in_progress.`);
  } else {
    console.log("Seeded finalized consultation (today).");
  }
}

// A: scheduled today, +90min, 50min, with note.
const scheduledTodayId = await schedule(maria.id, at(90), 50, "Retorno — lombalgia e insônia");
console.log("Seeded scheduled appointment today (Maria).");

// B: today +150min -> cancelled with reason.
const cancelledId = await schedule(joao.id, at(150), 50);
{
  const { data, error } = await app.rpc("cancel_scheduled_consultation", {
    target_consultation: cancelledId,
    reason: "Paciente pediu para remarcar",
  });
  if (error || !(data as RpcResult).ok) throw new Error(`cancel: ${error?.message ?? (data as RpcResult).code}`);
  console.log("Seeded cancelled appointment today (João).");
}

// C: today +210min -> started (in_progress).
const inProgressId = await schedule(joao.id, at(210), 50, "Primeira avaliação completa");
{
  const { data, error } = await app.rpc("start_scheduled_consultation", { target_consultation: inProgressId });
  if (error || !(data as RpcResult).ok) throw new Error(`start: ${error?.message ?? (data as RpcResult).code}`);
  console.log("Seeded in-progress consultation today (João).");
}

// D/E: upcoming days.
await schedule(maria.id, tomorrowAt(9), 50, "Reavaliação do plano");
await schedule(ana.id, inDaysAt(3, 14), 60);
console.log("Seeded tomorrow 09:00 (Maria) and +3 days 14:00 (Ana).");

const { data: check } = await app
  .from("consultations")
  .select("id, status, scheduled_for")
  .eq("org_id", orgId)
  .order("scheduled_for");
console.log("\nSeeded consultations:");
for (const row of check ?? []) console.log(`  ${row.status.padEnd(12)} ${row.scheduled_for}`);
console.log(`\nSign-in for the walk: ${EMAIL}`);
