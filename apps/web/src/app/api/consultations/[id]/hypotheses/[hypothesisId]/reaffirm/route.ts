import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

type ReaffirmBody = { expectedUpdatedAt?: string; confirmPattern?: string };

/**
 * Re-anchor a decision she already took to the chart as it stands now
 * (migration 0098).
 *
 * A hypothesis she had accepted and that later went stale was a dead end: every
 * decision RPC refuses a stale row and re-preparing only replaces drafts, so
 * the AI plan — which requires an accepted, non-stale hypothesis — could never
 * run again. The confirmation is NAMED (the client sends back the pattern it
 * displayed) so this can never become a bulk "mark everything current".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; hypothesisId: string }> }) {
  const { id, hypothesisId } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as ReaffirmBody;
  // A malformed timestamp is a bad REQUEST, not a server fault: without this it
  // reached Postgres and came back as an opaque 500.
  if (!body.expectedUpdatedAt || Number.isNaN(Date.parse(body.expectedUpdatedAt)) || !body.confirmPattern?.trim()) {
    return clinicalError("invalid_request");
  }

  const { data, error } = await supabase.rpc("reaffirm_consultation_hypothesis", {
    target_hypothesis: hypothesisId,
    expected_updated_at: body.expectedUpdatedAt,
    confirm_pattern: body.confirmPattern,
  });
  if (error) return clinicalError("internal_error");

  const result = data as { ok?: boolean; code?: string } | null;
  if (result?.ok) {
    const { data: consultation } = await supabase.from("consultations").select("org_id").eq("id", id).maybeSingle();
    // Auditable like every other clinical decision: who re-stated what, when.
    await recordAudit(supabase, "consultation.hypothesis.reaffirmed", {
      orgId: consultation?.org_id,
      entityType: "consultation_hypothesis",
      entityId: hypothesisId,
      metadata: { consultationId: id, outcome: result.code },
    });
  }
  return clinicalRpcResponse(result);
}
