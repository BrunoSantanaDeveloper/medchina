import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { detectSafetyFlags } from "@/lib/clinical-safety";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: answers } = await supabase
    .from("anamnesis_answers")
    .select("block_key, field_key, value")
    .eq("consultation_id", id);
  const safetyFlags = detectSafetyFlags(
    (answers ?? []).map((answer) => ({ text: answer.value, fieldKey: `${answer.block_key}.${answer.field_key}` })),
  );

  const { data, error } = await supabase.rpc("create_manual_consultation_plan", {
    target_consultation: id,
    target_safety_flags: safetyFlags,
  });
  if (error) return clinicalError("internal_error");
  return clinicalRpcResponse(data, (data as { code?: string } | null)?.code === "created" ? 201 : 200);
}
