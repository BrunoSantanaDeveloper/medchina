"use client";

import { createClient } from "@flyee/auth/client";

export type ProductEventName =
  | "journey.track_selected"
  | "journey.track_reentered"
  | "appointment.started"
  | "appointment.completed"
  | "appointment.abandoned"
  | "patient.created_inline"
  | "appointment.conflict"
  | "recording.started"
  | "recording.interrupted"
  | "recording.recovered"
  | "recording.upload_completed"
  | "recording.processing_completed"
  | "recording.failed"
  | "consultation.finalized"
  | "document.issued";

export function trackProductEvent(event: ProductEventName, properties: Record<string, string> = {}): void {
  const supabase = createClient();
  void supabase.rpc("track_product_event", {
    target_event: event,
    target_properties: { ...properties, platform: "web" },
  });
}
