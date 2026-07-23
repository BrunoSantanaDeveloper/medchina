"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics";

/**
 * Fires a single analytics event on mount from a Server Component page
 * (e.g. ViewContent on /planos). Renders nothing. No-op until the visitor
 * grants consent and the provider boots. Only sound to use on PUBLIC
 * marketing routes — never on clinical/authenticated screens.
 */
export default function TrackEvent({ event, props }: { event: string; props?: Record<string, unknown> }) {
  // Serialize so an inline-object `props` doesn't refire the effect each render.
  const serialized = props ? JSON.stringify(props) : "";
  useEffect(() => {
    track(event, serialized ? (JSON.parse(serialized) as Record<string, unknown>) : undefined);
  }, [event, serialized]);
  return null;
}
