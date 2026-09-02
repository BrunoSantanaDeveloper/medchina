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
    // `metadata` carries which diarized label is the practitioner. The pipeline
    // has always resolved and stored it; not selecting it here is why the
    // reviewer still reads "Speaker 1 / Speaker 2" and has to work out who said
    // what, on the screen where she checks the AI's draft against the audio.
    .select("id, status, result, validated_at, delete_audio_after, audio_path, metadata, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return clinicalError("internal_error");
  if (!data) return clinicalError("not_found");
  return Response.json({ ok: true, transcription: data });
}
