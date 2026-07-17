import { clinicalError, clinicalRpcResponse, createClinicalRequestClient } from "@/lib/clinical-route";

type StateBody = {
  action?: "local" | "uploading" | "uploaded" | "failed" | "cancel";
  durationSeconds?: number;
  sizeBytes?: number;
  mime?: string;
  checksumSha256?: string;
  audioPath?: string;
  errorCode?: string;
  failureStage?: "capture" | "upload" | "transcription" | "extraction" | "apply" | "deletion";
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const body = (await request.json().catch(() => ({}))) as StateBody;
  let rpc: { name: string; args: Record<string, unknown> } | undefined;
  if (body.action === "local") {
    rpc = {
      name: "mark_recording_local",
      args: {
        target_recording: id,
        target_duration_seconds: Math.max(0, Math.round(body.durationSeconds ?? 0)),
        target_size_bytes: Math.max(0, Math.round(body.sizeBytes ?? 0)),
        target_mime: body.mime ?? "audio/webm",
        target_checksum_sha256: body.checksumSha256 ?? null,
      },
    };
  } else if (body.action === "uploading") {
    rpc = { name: "mark_recording_uploading", args: { target_recording: id } };
  } else if (body.action === "uploaded" && body.audioPath) {
    rpc = { name: "confirm_recording_upload", args: { target_recording: id, target_audio_path: body.audioPath } };
  } else if (body.action === "cancel") {
    rpc = {
      name: "cancel_clinical_recording",
      args: { target_recording: id, target_error_code: body.errorCode ?? null },
    };
  } else if (body.action === "failed" && body.failureStage) {
    rpc = {
      name: "fail_clinical_recording",
      args: {
        target_recording: id,
        target_stage: body.failureStage,
        target_error_code: body.errorCode ?? "processing_failed",
      },
    };
  }
  if (!rpc) return clinicalError("invalid_request");

  const { data, error } = await supabase.rpc(rpc.name, rpc.args);
  if (error) return clinicalError("internal_error");
  return clinicalRpcResponse(data);
}
