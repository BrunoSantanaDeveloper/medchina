import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

type BeginBody = {
  mode?: "audio_only" | "ai";
  clientUploadId?: string;
  startTrial?: boolean;
  capturedOn?: "web" | "mobile";
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as BeginBody;
  if (!body.clientUploadId || !["audio_only", "ai"].includes(body.mode ?? "")) {
    return clinicalError("invalid_request");
  }

  const { data, error } = await supabase.rpc("begin_clinical_recording", {
    target_consultation: id,
    target_mode: body.mode,
    target_client_upload_id: body.clientUploadId,
    target_start_trial: body.startTrial === true,
    target_captured_on: body.capturedOn ?? "web",
  });
  if (error) return clinicalError("internal_error");

  const result = data as { ok?: boolean; recordingId?: string; code?: string } | null;
  if (result?.ok && result.code === "created") {
    const { data: consultation } = await supabase.from("consultations").select("org_id").eq("id", id).maybeSingle();
    await recordAudit(supabase, "recording.started", {
      orgId: consultation?.org_id,
      entityType: "recording",
      entityId: result.recordingId,
      metadata: { consultationId: id, mode: body.mode, capturedOn: body.capturedOn ?? "web" },
    });
  }
  return clinicalRpcResponse(data, result?.code === "created" ? 201 : 200);
}
