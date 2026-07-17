import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

type ReviewBody = {
  status?: "accepted" | "edited" | "rejected";
  pattern?: string;
  note?: string;
  expectedUpdatedAt?: string;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; hypothesisId: string }> }) {
  const { id, hypothesisId } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as ReviewBody;
  if (!body.status || !["accepted", "edited", "rejected"].includes(body.status)) {
    return clinicalError("invalid_request");
  }

  const { data, error } = await supabase.rpc("review_consultation_hypothesis", {
    target_hypothesis: hypothesisId,
    target_status: body.status,
    target_pattern: body.pattern ?? null,
    target_note: body.note ?? null,
    expected_updated_at: body.expectedUpdatedAt ?? null,
  });
  if (error) return clinicalError("internal_error");

  if ((data as { ok?: boolean } | null)?.ok) {
    const { data: consultation } = await supabase.from("consultations").select("org_id").eq("id", id).maybeSingle();
    await recordAudit(supabase, "consultation.hypothesis.reviewed", {
      orgId: consultation?.org_id,
      entityType: "consultation_hypothesis",
      entityId: hypothesisId,
      metadata: { consultationId: id, status: body.status },
    });
  }
  return clinicalRpcResponse(data);
}
