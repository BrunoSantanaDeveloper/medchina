import { processRecording } from "@/lib/clinical-pipeline";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * MedChina's own background job (the template's packages own theirs).
 * Transcribes a consultation recording and pre-fills its anamnesis.
 * Registered in app/api/inngest/route.ts.
 *
 * Concurrency is capped because each run holds an audio file in memory and
 * makes two Gemini calls; retries are low because a clinical draft that keeps
 * failing must surface to the professional, not retry silently forever.
 */
export const processRecordingFunction = inngest.createFunction(
  { id: "medchina-process-recording", retries: 1, concurrency: { limit: 2 } },
  { event: "medchina/recording.process" },
  async ({ event }) => {
    const supabase = createServiceClient();
    const result = await processRecording(supabase, event.data.recordingId);
    if (!result.ok) throw new Error(result.error);
    return result;
  },
);

export const clinicalFunctions = [processRecordingFunction];
