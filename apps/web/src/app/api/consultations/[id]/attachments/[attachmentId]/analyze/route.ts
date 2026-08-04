import { analyzeAttachment } from "@/lib/attachment-analysis";
import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { getAudioAllowance } from "@/lib/usage";
import { createServiceClient } from "@flyee/auth/service";

export const maxDuration = 120;

const BUCKET = "clinical-attachments";

/**
 * Read one attachment with the AI and store a DRAFT analysis for review.
 * Pro-gated (clinical reasoning) and gated on the patient's ai-processing
 * consent. The output is never applied to the record — it is a review artifact.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: attachment } = await supabase
    .from("consultation_attachments")
    .select("id, org_id, patient_id, mime, storage_path, status")
    .eq("id", attachmentId)
    .eq("consultation_id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!attachment || attachment.status !== "ready" || !attachment.storage_path) return clinicalError("not_found");

  const allowance = await getAudioAllowance(supabase, attachment.org_id);
  if (!allowance?.clinicalReasoning) return clinicalError("reasoning_not_available");

  // Consent is re-checked at storage time too (the RPC), but fail fast with a
  // clean code here.
  const { data: aiConsent } = await supabase.rpc("has_active_consent", {
    target_org: attachment.org_id,
    target_patient: attachment.patient_id,
    term_slug: "ai-processing",
  });
  if (!aiConsent) return clinicalError("ai_consent_required");

  // Download the object with the service role and pass it to the model as
  // base64 — GEMINI_API_KEY is server-only, this never touches the client.
  const service = createServiceClient();
  const { data: file, error: downloadError } = await service.storage.from(BUCKET).download(attachment.storage_path);
  if (downloadError || !file) return clinicalError("internal_error");

  let result;
  try {
    const dataBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    result = await analyzeAttachment({ mime: attachment.mime, dataBase64 });
  } catch (error) {
    console.error("[attachment.analyze] provider call failed", error);
    return clinicalError("provider_unavailable");
  }

  const { data, error } = await service.rpc("save_attachment_analysis", {
    target_attachment: attachmentId,
    target_analysis: {
      summary: result.summary,
      observations: result.observations,
      extractedValues: result.extractedValues,
      limitations: result.limitations,
    },
    target_model: result.model,
    target_prompt_version: result.promptVersion,
  });
  if (error) return clinicalError("internal_error");
  const saved = data as { ok?: boolean; code?: string } | null;
  if (!saved?.ok) return clinicalRpcResponse(saved);

  await recordAudit(supabase, "consultation.attachment.analyzed", {
    entityType: "consultation",
    entityId: id,
    metadata: { attachmentId, model: result.model, promptVersion: result.promptVersion },
  });

  return Response.json({ ok: true, analysis: result });
}
