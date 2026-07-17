import { supabase } from "@/lib/supabase";

export type ProductEventName =
  | "recording.started"
  | "recording.interrupted"
  | "recording.recovered"
  | "recording.upload_completed"
  | "recording.processing_completed"
  | "recording.failed";

export function trackProductEvent(
  event: ProductEventName,
  properties: { mode?: "ai" | "audio_only"; state?: string; reason_code?: string } = {},
): void {
  void supabase?.rpc("track_product_event", {
    target_event: event,
    target_properties: { ...properties, platform: "mobile" },
  });
}
