import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { processRecording } from "@/lib/clinical-pipeline";
import { createClient } from "@flyee/auth/server";
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
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // RLS: only an org member can see this row.
  const { data: recording } = await supabase
    .from("recordings")
    .select("id, org_id, status, consultation_id")
    .eq("id", id)
    .maybeSingle();
  if (!recording) return NextResponse.json({ error: "Recording not found." }, { status: 404 });

  if (recording.status !== "uploaded" && recording.status !== "failed") {
    return NextResponse.json({ error: `Recording is ${recording.status}.` }, { status: 409 });
  }

  recordAudit(supabase, "recording.processing.requested", {
    orgId: recording.org_id,
    entityType: "recording",
    entityId: recording.id,
  });

  const queued = await sendEvent("medchina/recording.process", { recordingId: recording.id });
  if (queued.sent) {
    await supabase.from("recordings").update({ status: "processing" }).eq("id", recording.id);
    return NextResponse.json({ queued: true });
  }

  // Inline fallback — bounded by maxDuration above.
  const result = await processRecording(createServiceClient(), recording.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ queued: false, ...result });
}
