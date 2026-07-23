export type PlanLimits = Record<string, unknown>;

function numericLimit(limits: PlanLimits, key: string): number {
  const value = limits[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function derivePlanFeatures(limits: PlanLimits) {
  const hasLibraryLimit = Object.prototype.hasOwnProperty.call(limits, "library_messages");
  return {
    audioMinutes: numericLimit(limits, "audio_minutes"),
    libraryMessages: hasLibraryLimit ? numericLimit(limits, "library_messages") : null,
    clinicalReasoning: numericLimit(limits, "clinical_reasoning") > 0,
  };
}
