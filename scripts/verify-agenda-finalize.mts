/** Finish the seed: give the first in_progress consultation real content and finalize it. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(import.meta.dirname, "..");
for (const line of readFileSync(resolve(ROOT, "apps/web/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !(m[1] in process.env) && m[2].trim()) process.env[m[1]] = m[2].trim();
}

const app = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});
const { error: signInError } = await app.auth.signInWithPassword({
  email: "verify-agenda@medchina.dev",
  password: "Verify!Agenda2026#mc",
});
if (signInError) throw new Error(signInError.message);

const { data: rows, error } = await app
  .from("consultations")
  .select("id, status, scheduled_for, clinical_revision")
  .eq("status", "in_progress")
  .order("scheduled_for")
  .limit(1);
if (error || !rows?.length) throw new Error(error?.message ?? "no in_progress row");
const target = rows[0];

const { error: updateError } = await app
  .from("consultations")
  .update({ chief_complaint: "Dor cervical há 3 semanas, piora ao fim do dia." })
  .eq("id", target.id);
if (updateError) throw new Error(updateError.message);

const { data: fresh } = await app.from("consultations").select("clinical_revision").eq("id", target.id).single();
const { data, error: finalizeError } = await app.rpc("finalize_consultation", {
  target_consultation: target.id,
  expected_revision: fresh!.clinical_revision,
  acknowledged_warnings: [],
});
if (finalizeError) throw new Error(finalizeError.message);
console.log(JSON.stringify(data));
