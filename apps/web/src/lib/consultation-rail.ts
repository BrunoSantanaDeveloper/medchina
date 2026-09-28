import type { ConsultationJourney, JourneyStepKey, JourneyStepState } from "@flyee/clinical";

/**
 * The step rail of the consultation screen.
 *
 * The journey already derives seven steps and the state of each one
 * (`deriveConsultationJourney`); the screen simply never drew them, so the
 * professional read a long page with no map of what was done and what was
 * missing. The rail is that map — and nothing else: it holds no rule of its
 * own, blocks nothing, and keeps no index. "Where she is" comes from the
 * anchors on screen, so there is no stored position to drift out of sync.
 *
 * What it must NOT become: a wizard. The reasons are in the page itself —
 * one capture surface per tab, and she writes WHILE recording — so the rail
 * scrolls the single page and never mounts a step at a time.
 */

/** Where a step lives on the screen. */
export type RailTarget =
  | { kind: "anchor"; id: string }
  /**
   * The review is not a place: it is the first field the extraction flagged,
   * wherever that is.
   */
  | { kind: "attention" };

/**
 * An EXPLICIT map, never a fallback. A step whose place is not written here
 * would scroll nowhere and read as a dead control — which is exactly what the
 * two recording states of "next action" do today, telling her to go to
 * "Gravações" with nothing to click.
 */
export const RAIL_TARGETS: Record<JourneyStepKey, RailTarget> = {
  // Consent and finalize are both controls of the context bar at the top.
  consent: { kind: "anchor", id: "etapa-context" },
  record: { kind: "anchor", id: "etapa-record" },
  review: { kind: "attention" },
  hypotheses: { kind: "anchor", id: "etapa-hypotheses" },
  plan: { kind: "anchor", id: "etapa-plan" },
  prescription: { kind: "anchor", id: "etapa-prescription" },
  finalize: { kind: "anchor", id: "etapa-context" },
};

/** The order the screen itself follows. The rail never invents another. */
export const RAIL_ORDER: readonly JourneyStepKey[] = [
  "consent",
  "record",
  "review",
  "hypotheses",
  "plan",
  "prescription",
  "finalize",
] as const;

export interface RailItem {
  key: JourneyStepKey;
  state: JourneyStepState;
  /** Only the steps the journey numbers carry a number (record, hypotheses, plan). */
  number?: number;
  /** Fields to review, hypotheses awaiting a decision, loose ends before finalizing. */
  count?: number;
  optional: boolean;
}

/**
 * The steps the rail shows: everything the journey does not hide.
 *
 * The list GROWS and SHRINKS while she works (the Pro entitlement, a plan that
 * appears, a prescription she starts), which is why the rail never says
 * "step 3 of 8": the total is not a fact about her consultation.
 */
export function railItems(steps: ConsultationJourney["steps"]): RailItem[] {
  return RAIL_ORDER.map((key) => ({ key, step: steps[key] }))
    .filter((entry) => entry.step && entry.step.state !== "hidden")
    .map(({ key, step }) => ({
      key,
      state: step.state,
      ...(step.number === undefined ? {} : { number: step.number }),
      ...(step.count === undefined ? {} : { count: step.count }),
      optional: step.optional,
    }));
}

/**
 * Anchors that identify ONE step without ambiguity. `etapa-context` is left
 * out on purpose: consent and finalize share it, so being at the top of the
 * page says nothing about which of the two she is looking at.
 */
const ANCHOR_STEP: Record<string, JourneyStepKey> = {
  "etapa-record": "record",
  "etapa-hypotheses": "hypotheses",
  "etapa-plan": "plan",
  "etapa-prescription": "prescription",
};

/**
 * Which item to mark as current, from the anchor on screen. Nothing is marked
 * when the anchor is ambiguous or its step is not in the rail — an honest
 * "no answer" beats a highlight on the wrong step.
 */
export function activeRailKey(items: RailItem[], visibleAnchorId: string | null): JourneyStepKey | null {
  if (!visibleAnchorId) return null;
  const key = ANCHOR_STEP[visibleAnchorId];
  return key && items.some((item) => item.key === key) ? key : null;
}

/** The anchors worth observing to derive the current step. */
export const RAIL_OBSERVED_ANCHORS = Object.keys(ANCHOR_STEP);
