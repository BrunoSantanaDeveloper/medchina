import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { detectSafetyFlags } from "@/lib/clinical-safety";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const [answersResult, consultationResult] = await Promise.all([
    supabase.from("anamnesis_answers").select("block_key, field_key, value").eq("consultation_id", id),
    supabase.from("consultations").select("chief_complaint").eq("id", id).maybeSingle(),
  ]);
  // The chief complaint lives on the consultation row, not among the answers,
  // and it is where a pregnancy or an anticoagulant is most often first written
  // down. A manual plan used to be built with it unscanned.
  const chiefComplaint = consultationResult.data?.chief_complaint as string | null | undefined;
  const safetyFlags = detectSafetyFlags([
    ...(chiefComplaint ? [{ text: chiefComplaint, fieldKey: "chiefComplaint" }] : []),
    ...(answersResult.data ?? []).map((answer) => ({
      text: answer.value,
      fieldKey: `${answer.block_key}.${answer.field_key}`,
    })),
  ]);

  const { data, error } = await supabase.rpc("create_manual_consultation_plan", {
    target_consultation: id,
    target_safety_flags: safetyFlags,
  });
  if (error) return clinicalError("internal_error");
  return clinicalRpcResponse(data, (data as { code?: string } | null)?.code === "created" ? 201 : 200);
}
