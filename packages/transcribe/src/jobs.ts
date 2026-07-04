import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

import { processTranscription } from "./transcribe";

/** Background transcription — triggered by requestTranscription(). */
export const transcribeAudioFunction = inngest.createFunction(
  { id: "transcribe-audio", retries: 2, concurrency: { limit: 3 } },
  { event: "transcribe/audio.transcribe" },
  async ({ event }) => {
    const supabase = createServiceClient();
    const result = await processTranscription(supabase, event.data.transcriptionId);
    if (!result.ok) throw new Error(result.error);
    return result;
  },
);

export const transcribeFunctions = [transcribeAudioFunction];
