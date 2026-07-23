export type HypothesesPanelMode = "locked" | "allowed" | "read_only" | "downgrade" | "hidden";

export function deriveHypothesesPanelMode(input: {
  reasoningEntitled: boolean;
  canPrepare: boolean;
  isFinalized: boolean;
  hasHypotheses: boolean;
}): HypothesesPanelMode {
  if (input.hasHypotheses) {
    if (input.isFinalized || (input.reasoningEntitled && !input.canPrepare)) return "read_only";
    if (!input.reasoningEntitled) return "downgrade";
    return "allowed";
  }
  if (input.isFinalized) return "hidden";
  if (!input.reasoningEntitled) return "locked";
  return input.canPrepare ? "allowed" : "read_only";
}
