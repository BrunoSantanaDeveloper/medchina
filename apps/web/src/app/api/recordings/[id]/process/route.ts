import { recordAudit } from "@/lib/audit";
import { processRecording } from "@/lib/clinical-pipeline";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { notifyRecordingStatus } from "@/lib/mobile-push";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";

// Transcription + extraction are two Gemini calls over an audio file.
export const maxDuration = 300;

/**
 * Kick off the clinical pipeline for one recording (PRD §10.2). The heavy work
 * runs in a background job; without Inngest (local dev with no `inngest-cli
 * dev`, or missing keys in production) it falls back to running inline — the
 * same contract every capability package in this template follows.
 *
 * Authorization: the caller's own client must be able to READ the recording,
 * which RLS only allows for members of its organization. The inline fallback
 * then runs with the service role, after that check has passed.
 *
 * GEMINI_API_KEY is server-only, which is why this cannot be a client call.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  // RLS: only an org member can see this row.
  const { data: recording } = await supabase
    .from("recordings")
    .select("id, org_id, status, consultation_id")
    .eq("id", id)
    .maybeSingle();
  if (!recording) return clinicalError("not_found");

  const { data: claimData, error: claimError } = await supabase.rpc("claim_recording_for_processing", {
    target_recording: recording.id,
  });
  if (claimError) return clinicalError("internal_error");
  const claim = claimData as {
    ok?: boolean;
    code?: string;
    claimId?: string;
    transcriptionId?: string;
  } | null;
  if (!claim?.ok) return clinicalRpcResponse(claim);
  if (claim.code === "ready") return clinicalRpcResponse(claim);
  if (claim.code === "processing_already_claimed") {
    return Response.json(claim, { status: 202 });
  }
  if (!claim.claimId) return clinicalError("internal_error");

  recordAudit(supabase, "recording.processing.requested", {
    orgId: recording.org_id,
    entityType: "recording",
    entityId: recording.id,
  });

  const queued = await sendEvent("medchina/recording.process", {
    recordingId: recording.id,
    claimId: claim.claimId,
  });
  if (queued.sent) {
    return Response.json({ ok: true, code: "claimed", queued: true, recordingId: recording.id }, { status: 202 });
  }

  // Inline fallback — bounded by maxDuration above.
  const service = createServiceClient();
  const result = await processRecording(service, recording.id, claim.claimId);
  await notifyRecordingStatus(service, recording.id, result.ok ? "recording_ready" : "recording_failed");
  if (!result.ok) return clinicalError(result.code, undefined, result.code === "provider_unavailable" ? 503 : 409);

  return Response.json({ queued: false, ...result });
}
