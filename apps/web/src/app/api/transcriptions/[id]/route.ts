import { clinicalError, createClinicalRequestClient } from "@/lib/clinical-route";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClinicalRequestClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clinicalError("not_authenticated");

  const { data, error } = await supabase
    .from("transcriptions")
    .select("id, status, result, validated_at, delete_audio_after, audio_path, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return clinicalError("internal_error");
  if (!data) return clinicalError("not_found");
  return Response.json({ ok: true, transcription: data });
}
