import { recordAudit } from "@/lib/audit";
import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";
import { createServiceClient } from "@flyee/auth/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase.rpc("validate_clinical_transcription", { target_transcription: id });
  if (error) return clinicalError("internal_error");
  const validated = data as { ok?: boolean; deleteAudioAfter?: boolean } | null;
  if (validated?.ok) {
    await recordAudit(supabase, "transcription.validated", {
      entityType: "transcription",
      entityId: id,
    });

    // The pre-launch default is deletion immediately after professional
    // validation. Validation remains successful if Storage is temporarily
    // unavailable; the retained source stays visible and can be retried.
    if (validated.deleteAudioAfter) {
      const { data: recording } = await supabase
        .from("recordings")
        .select("id")
        .eq("transcription_id", id)
        .maybeSingle();
      if (recording) {
        const { data: requestedData } = await supabase.rpc("request_recording_audio_deletion", {
          target_recording: recording.id,
        });
        const requested = requestedData as { ok?: boolean; audioPath?: string | null } | null;
        if (requested?.ok && requested.audioPath) {
          const service = createServiceClient();
          const { error: removeError } = await service.storage.from("transcriptions").remove([requested.audioPath]);
          if (!removeError) {
            await supabase.rpc("complete_recording_audio_deletion", { target_recording: recording.id });
          }
        }
      }
    }
  }
  return clinicalRpcResponse(data);
}
