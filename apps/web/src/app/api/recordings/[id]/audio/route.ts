import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { createServiceClient } from "@flyee/auth/service";

/** Return a short-lived URL only after RLS confirms that the practitioner may
 * read the recording. The Storage object remains private. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: recording, error } = await supabase
    .from("recordings")
    .select("id, org_id, audio_path, audio_deleted_at, transcription_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return clinicalError("internal_error");
  if (!recording?.audio_path || recording.audio_deleted_at) return clinicalError("not_found");

  const service = createServiceClient();
  const { data: signed, error: signedError } = await service.storage
    .from("transcriptions")
    .createSignedUrl(recording.audio_path, 10 * 60);
  if (signedError || !signed?.signedUrl) return clinicalError("not_found");

  await recordAudit(supabase, "recording.audio.accessed", {
    orgId: recording.org_id,
    entityType: "recording",
    entityId: id,
    metadata: { transcriptionId: recording.transcription_id },
  });
  return Response.json({ ok: true, url: signed.signedUrl, expiresIn: 10 * 60 });
}

/** Delete retained source audio only after the professional validates it. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data: requestData, error: requestError } = await supabase.rpc("request_recording_audio_deletion", {
    target_recording: id,
  });
  if (requestError) return clinicalError("internal_error");

  const requested = requestData as {
    ok?: boolean;
    code?: string;
    audioPath?: string | null;
    transcriptionId?: string;
  } | null;
  if (!requested?.ok) return clinicalRpcResponse(requested);

  if (requested.audioPath) {
    const service = createServiceClient();
    const { error: removeError } = await service.storage.from("transcriptions").remove([requested.audioPath]);
    if (removeError) {
      if (requested.transcriptionId) {
        await service
          .from("transcriptions")
          .update({ deletion_error: "storage_delete_failed" })
          .eq("id", requested.transcriptionId);
      }
      return clinicalError("audio_deletion_failed");
    }
  }

  const { data: completedData, error: completedError } = await supabase.rpc("complete_recording_audio_deletion", {
    target_recording: id,
  });
  if (completedError) return clinicalError("internal_error");
  const completed = completedData as { ok?: boolean } | null;
  if (completed?.ok) {
    await recordAudit(supabase, "recording.audio.deleted", {
      entityType: "recording",
      entityId: id,
      metadata: { transcriptionId: requested.transcriptionId },
    });
  }
  return clinicalRpcResponse(completed);
}
