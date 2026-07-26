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
  | "document.issued"
  // Out-of-consultation layer (biblioteca, acervo, briefing, protocols).
  // These answer the business question the feature set was built on: does
  // studying between consultations become a habit, and does it drive upgrade?
  | "library.message_sent"
  | "library.quota_hit"
  | "case_review.started"
  | "acervo.document_opened"
  | "citation.opened"
  | "briefing.opened"
  | "protocol.saved"
  | "upgrade.prompt_viewed"
  | "upgrade.prompt_clicked"
  | "billing.contact_clicked";

export type CommercialEventOrigin = "menu" | "consultation" | "home" | "usage" | "billing";
// Kept in sync with the value allowlist inside `track_product_event`
// (migration 0054): a feature the RPC does not know is dropped in silence, so
// the click would be counted without ever saying what it was for.
export type CommercialEventFeature = "plans" | "audio" | "clinical_reasoning" | "payment" | "audio_pack";

export function trackCommercialEvent(
  event: Extract<ProductEventName, "upgrade.prompt_viewed" | "upgrade.prompt_clicked" | "billing.contact_clicked">,
  origin: CommercialEventOrigin,
  feature: CommercialEventFeature,
): void {
  trackProductEvent(event, { origin, feature });
}

export function trackProductEvent(event: ProductEventName, properties: Record<string, string> = {}): void {
  const supabase = createClient();
  // A PostgREST builder is a THENABLE: it only issues the request when it is
  // awaited or `.then()`-ed. Discarding it with `void` silently sends nothing
  // — which is why no product event was ever recorded before this call was
  // terminated. Both handlers swallow: telemetry must never reach the user.
  void supabase
    .rpc("track_product_event", {
      target_event: event,
      target_properties: { ...properties, platform: "web" },
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
