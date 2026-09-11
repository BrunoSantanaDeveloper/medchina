import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransition,
  deriveConsultationCapabilities,
  deriveConsultationExperience,
  deriveConsultationJourney,
  deriveConsultationState,
  derivePlanValidationGate,
  factLoading,
  factReady,
  factUnavailable,
  getConsultationCapabilities,
  hypothesisFactsFromRows,
  type JourneyFacts,
  planFactsFromRow,
  remoteError,
  remoteEmpty,
  remoteLoading,
  remoteSuccess,
  sanitizeInternalNext,
} from "./index.ts";

test("consultation transitions keep terminal records terminal", () => {
  assert.equal(canTransition("scheduled", "in_progress"), true);
  assert.equal(canTransition("draft", "finalized"), true);
  assert.equal(canTransition("finalized", "draft"), false);
  assert.equal(canTransition("cancelled", "scheduled"), false);
  assert.equal(canTransition("cancelled", "scheduled", { canRestoreCancelledAppointment: true }), true);
});

test("recording operation takes precedence over consultation status", () => {
  assert.equal(
    deriveConsultationExperience({ consultationStatus: "awaiting_review", recordingStatus: "uploading" }),
    "uploading",
  );
  assert.equal(
    deriveConsultationExperience({ consultationStatus: "in_progress", recordingStatus: "failed" }),
    "failed",
  );
  assert.equal(
    deriveConsultationExperience({ consultationStatus: "finalized", recordingStatus: "failed" }),
    "finalized",
  );
});

test("canonical state considers every recording and preserves terminal consultations", () => {
  assert.equal(
    deriveConsultationState({ status: "awaiting_review" }, [{ status: "ready" }, { status: "uploading" }]),
    "uploading",
  );
  assert.equal(deriveConsultationState({ status: "finalized" }, [{ status: "failed" }]), "finalized");
  assert.equal(getConsultationCapabilities("processing").canFinalize, false);
});

test("pending audio blocks new capture and finalization", () => {
  const capabilities = deriveConsultationCapabilities({
    consultationStatus: "awaiting_review",
    recordingStatus: "processing",
    hasValidatedPlan: true,
  });
  assert.equal(capabilities.canRecord, false);
  assert.equal(capabilities.canFinalize, false);
  assert.equal(capabilities.canIssueValidatedDocument, true);
});

test("finalized records allow addenda and validated document issuance only", () => {
  const capabilities = deriveConsultationCapabilities({
    consultationStatus: "finalized",
    recordingStatus: "ready",
    hasValidatedPlan: true,
  });
  assert.equal(capabilities.canEditClinicalRecord, false);
  assert.equal(capabilities.canAddAddendum, true);
  assert.equal(capabilities.canIssueValidatedDocument, true);
});

test("remote state constructors retain optional previous data", () => {
  assert.deepEqual(remoteLoading("cached"), { status: "loading", previous: "cached" });
  assert.deepEqual(remoteSuccess(3), { status: "success", data: 3 });
  assert.deepEqual(remoteEmpty(), { status: "empty" });
  assert.deepEqual(remoteError("failed", 2), { status: "error", error: "failed", previous: 2 });
});

test("sanitizeInternalNext accepts only same-origin absolute paths", () => {
  assert.equal(sanitizeInternalNext("/consultas/abc?tab=plano#top"), "/consultas/abc?tab=plano#top");
  assert.equal(sanitizeInternalNext("https://evil.example"), "/inicio");
  assert.equal(sanitizeInternalNext("//evil.example/path"), "/inicio");
  assert.equal(sanitizeInternalNext("/%2F%2Fevil.example"), "/inicio");
  assert.equal(sanitizeInternalNext("/\\evil.example"), "/inicio");
  assert.equal(sanitizeInternalNext("javascript:alert(1)", "/pacientes"), "/pacientes");
  assert.equal(sanitizeInternalNext(null, "https://evil.example"), "/inicio");
});

/* --------------------------- the consultation journey --------------------------- */

const NO_HYPOTHESES = { draftFresh: 0, draftStale: 0, acceptedFresh: 0, acceptedStale: 0, rejected: 0 };

/** A Pro workspace, consents granted, a chart with content and nothing pending. */
function facts(overrides: Partial<JourneyFacts> = {}): JourneyFacts {
  const base: JourneyFacts = {
    consultationStatus: "in_progress",
    recordingStatus: null,
    isPrimaryTab: true,
    saveFailed: false,
    consents: factReady({ audio: true, ai: true, images: true, aiRefused: false }),
    reasoningEntitled: factReady(true),
    record: {
      recordedAnswerCount: 6,
      hasChiefComplaint: true,
      hasSummary: false,
      attentionCount: 0,
      aiDraftPresent: false,
      tongueRecorded: true,
      pulseRecorded: true,
      legacyRecord: false,
      gapCount: 0,
    },
    hypotheses: factReady({ ...NO_HYPOTHESES }),
    plan: factReady(null),
    prescription: factReady(null),
  };
  return { ...base, ...overrides, record: { ...base.record, ...(overrides.record ?? {}) } };
}

test("preparing hypotheses is blocked by the same facts the route checks", () => {
  assert.equal(deriveConsultationJourney(facts()).gates.prepareHypotheses.state, "available");

  const empty = deriveConsultationJourney(
    facts({ record: { recordedAnswerCount: 0, hasChiefComplaint: false } as JourneyFacts["record"] }),
  ).gates.prepareHypotheses;
  assert.deepEqual(empty, { state: "blocked", reason: "nothing_recorded" });

  // Never asked is not a no: reasoning over a chart she typed needs no second
  // authorization (0102), so the step stays available.
  const neverAsked = deriveConsultationJourney(
    facts({ consents: factReady({ audio: true, ai: false, images: false, aiRefused: false }) }),
  ).gates.prepareHypotheses;
  assert.equal(neverAsked.state, "available");

  // Said no, though, is respected — and named after the server's code.
  const refused = deriveConsultationJourney(
    facts({ consents: factReady({ audio: true, ai: false, images: false, aiRefused: true }) }),
  ).gates.prepareHypotheses;
  assert.deepEqual(refused, { state: "blocked", reason: "ai_consent_refused" });

  const capturing = deriveConsultationJourney(facts({ recordingStatus: "processing" })).gates.prepareHypotheses;
  assert.deepEqual(capturing, { state: "blocked", reason: "capture_in_flight" });

  const saveBroken = deriveConsultationJourney(facts({ saveFailed: true })).gates.prepareHypotheses;
  assert.deepEqual(saveBroken, { state: "blocked", reason: "save_failed" });
});

test("a missing tongue or pulse warns but never blocks", () => {
  const gate = deriveConsultationJourney(
    facts({ record: { tongueRecorded: false } as JourneyFacts["record"] }),
  ).gates.prepareHypotheses;
  assert.equal(gate.state, "available");
  assert.deepEqual(gate.state === "available" ? gate.soft : [], ["exam_partial"]);
});

test("a fact that is loading is neither available nor blocked, and a failed fetch is unknown", () => {
  assert.equal(deriveConsultationJourney(facts({ consents: factLoading() })).gates.prepareHypotheses.state, "loading");
  assert.equal(
    deriveConsultationJourney(facts({ reasoningEntitled: factUnavailable() })).gates.prepareHypotheses.state,
    "unknown",
  );
  assert.equal(deriveConsultationJourney(facts({ plan: factUnavailable() })).gates.preparePlanAi.state, "unknown");
  // And the bar never recommends finalizing while the decisions are unknown:
  // with the hypotheses settled, the plan is the last thing that could be open.
  assert.equal(
    deriveConsultationJourney(
      facts({ hypotheses: factReady({ ...NO_HYPOTHESES, acceptedFresh: 1 }), plan: factLoading() }),
    ).next.key,
    "loading",
  );
});

test("a manual plan needs something recorded, like every step after the record", () => {
  const empty = deriveConsultationJourney(
    facts({ record: { recordedAnswerCount: 0, hasChiefComplaint: false } as JourneyFacts["record"] }),
  );
  assert.deepEqual(empty.gates.createManualPlan, { state: "blocked", reason: "nothing_recorded" });
  assert.equal(empty.steps.plan.state, "blocked");
  assert.equal(deriveConsultationJourney(facts()).gates.createManualPlan.state, "available");
  assert.equal(
    deriveConsultationJourney(
      facts({ plan: factReady(planFactsFromRow({ status: "draft", origin: "manual", objective: "", modalities: {} })) }),
    ).gates.createManualPlan.state,
    "hidden",
    "with a plan on file there is nothing to create",
  );
});

test("an accepted hypothesis that went stale does not unlock the AI plan", () => {
  const stale = deriveConsultationJourney(
    facts({ hypotheses: factReady({ ...NO_HYPOTHESES, acceptedStale: 1 }) }),
  ).gates.preparePlanAi;
  assert.deepEqual(stale, { state: "blocked", reason: "accepted_hypothesis_required" });

  const fresh = deriveConsultationJourney(facts({ hypotheses: factReady({ ...NO_HYPOTHESES, acceptedFresh: 1 }) }))
    .gates.preparePlanAi;
  assert.equal(fresh.state, "available");
});

test("without Pro the reasoning steps are hidden, not blocked, and the numbers close up", () => {
  const free = deriveConsultationJourney(facts({ reasoningEntitled: factReady(false) }));
  assert.equal(free.gates.prepareHypotheses.state, "hidden");
  assert.equal(free.steps.hypotheses.state, "hidden");
  assert.equal(free.steps.hypotheses.number, undefined);
  assert.equal(free.steps.record.number, 1);
  assert.equal(free.steps.plan.number, 2, "the plan keeps a sequential number");

  const pro = deriveConsultationJourney(facts());
  assert.equal(pro.steps.record.number, 1);
  assert.equal(pro.steps.hypotheses.number, 2);
  assert.equal(pro.steps.plan.number, 3);
});

test("finalizing is blocked while a recording is unresolved, and stays visible", () => {
  const pending = deriveConsultationJourney(facts({ recordingStatus: "failed" }));
  assert.deepEqual(pending.gates.finalize, { state: "blocked", reason: "recording_pending" });
  assert.equal(pending.steps.finalize.state, "blocked");
  assert.equal(pending.steps.finalize.reason, "recording_pending");
  assert.equal(deriveConsultationJourney(facts()).gates.finalize.state, "available");
});

test("the recommended next action follows the real state of the record", () => {
  assert.equal(deriveConsultationJourney(facts({ consultationStatus: "scheduled" })).next.key, "start");
  assert.equal(deriveConsultationJourney(facts({ saveFailed: true })).next.key, "retry-save");
  assert.equal(deriveConsultationJourney(facts({ recordingStatus: "recording" })).next.key, "recording");
  assert.equal(deriveConsultationJourney(facts({ recordingStatus: "uploaded" })).next.key, "process-recording");
  assert.equal(
    deriveConsultationJourney(facts({ record: { recordedAnswerCount: 0, hasChiefComplaint: false } as JourneyFacts["record"] }))
      .next.key,
    "record",
  );
  assert.deepEqual(
    deriveConsultationJourney(facts({ record: { attentionCount: 2 } as JourneyFacts["record"] })).next,
    { key: "review-attention", count: 2, step: "review" },
  );
  assert.equal(deriveConsultationJourney(facts()).next.key, "prepare-hypotheses");
  assert.deepEqual(
    deriveConsultationJourney(facts({ hypotheses: factReady({ ...NO_HYPOTHESES, draftFresh: 3 }) })).next,
    { key: "decide-hypotheses", count: 3, step: "hypotheses" },
  );
  assert.equal(
    deriveConsultationJourney(facts({ hypotheses: factReady({ ...NO_HYPOTHESES, acceptedStale: 1 }) })).next.key,
    "hypotheses-stale",
  );
  // No consent recorded and nothing prepared: the next action is to prepare,
  // not to go chase an authorization the step no longer needs.
  assert.equal(
    deriveConsultationJourney(
      facts({ consents: factReady({ audio: true, ai: false, images: false, aiRefused: false }) }),
    ).next.key,
    "prepare-hypotheses",
  );
  const withDraftPlan = facts({
    hypotheses: factReady({ ...NO_HYPOTHESES, acceptedFresh: 1 }),
    plan: factReady(planFactsFromRow({ status: "draft", origin: "ai", objective: "Aliviar a dor", modalities: { acupuncture: { enabled: true } } })),
  });
  assert.equal(deriveConsultationJourney(withDraftPlan).next.key, "validate-plan");
  const validated = facts({
    hypotheses: factReady({ ...NO_HYPOTHESES, acceptedFresh: 1 }),
    plan: factReady(planFactsFromRow({ status: "validated", origin: "ai", objective: "x", modalities: { acupuncture: { enabled: true } } })),
  });
  assert.equal(deriveConsultationJourney(validated).next.key, "finalize");
  assert.equal(deriveConsultationJourney(facts({ consultationStatus: "finalized" })).next.key, "finalized");
});

test("the finalize dialog can predict the same loose ends the database reports", () => {
  const journey = deriveConsultationJourney(
    facts({
      record: { attentionCount: 1 } as JourneyFacts["record"],
      hypotheses: factReady({ ...NO_HYPOTHESES, draftStale: 2 }),
      plan: factReady(planFactsFromRow({ status: "draft", origin: "manual", objective: "", modalities: {} })),
      prescription: factReady({ status: "draft" }),
    }),
  );
  assert.deepEqual(journey.finalizeLooseEnds, [
    "attention_fields",
    "draft_hypotheses",
    "draft_plan",
    "draft_prescription",
  ]);
  assert.deepEqual(deriveConsultationJourney(facts()).finalizeLooseEnds, []);
});

test("the cost of editing is only announced while there is something to lose", () => {
  assert.equal(deriveConsultationJourney(facts()).editingInvalidatesOutputs, false);
  assert.equal(
    deriveConsultationJourney(facts({ hypotheses: factReady({ ...NO_HYPOTHESES, acceptedFresh: 1 }) }))
      .editingInvalidatesOutputs,
    true,
  );
  assert.equal(
    deriveConsultationJourney(facts({ hypotheses: factReady({ ...NO_HYPOTHESES, acceptedStale: 1 }) }))
      .editingInvalidatesOutputs,
    false,
    "already stale: there is nothing left to invalidate",
  );
  assert.equal(
    deriveConsultationJourney(
      facts({ plan: factReady(planFactsFromRow({ status: "draft", origin: "manual", objective: "x", modalities: {} })) }),
    ).editingInvalidatesOutputs,
    true,
  );
});

test("plan validation mirrors the database rule, in the same order", () => {
  const row = (overrides: Record<string, unknown> = {}) =>
    planFactsFromRow({
      status: "draft",
      origin: "ai",
      objective: "Reduzir a dor lombar",
      modalities: { acupuncture: { enabled: true } },
      safety_flags: [],
      ...overrides,
    });
  const gate = (plan: ReturnType<typeof row>, acknowledged = false) =>
    derivePlanValidationGate(plan, { acknowledged, consultationStatus: "in_progress" });

  assert.equal(gate(row()).state, "available");
  assert.deepEqual(gate(row({ stale_at: "2026-09-10T12:00:00Z" })), { state: "blocked", reason: "plan_stale" });
  assert.deepEqual(gate(row({ objective: "   " })), { state: "blocked", reason: "plan_objective_required" });
  assert.deepEqual(gate(row({ modalities: { acupuncture: { enabled: false } } })), {
    state: "blocked",
    reason: "plan_modality_required",
  });
  assert.deepEqual(gate(row({ modalities: { moxibustion: { enabled: true } } })), {
    state: "blocked",
    reason: "moxibustion_checklist_required",
  });
  assert.equal(
    gate(row({ modalities: { moxibustion: { enabled: true, contraindicationChecklist: ["Sem febre"] } } })).state,
    "available",
  );
  assert.deepEqual(gate(row({ safety_flags: [{ category: "medication" }] })), {
    state: "blocked",
    reason: "safety_acknowledgement_required",
  });
  assert.equal(gate(row({ safety_flags: [{ category: "medication" }] }), true).state, "available");
  // Signing after the record is closed is allowed (0093) — only a cancelled one is not.
  assert.equal(derivePlanValidationGate(row(), { acknowledged: true, consultationStatus: "finalized" }).state, "available");
  assert.equal(derivePlanValidationGate(row(), { acknowledged: true, consultationStatus: "cancelled" }).state, "hidden");
  assert.equal(gate(row({ status: "validated" })).state, "hidden");
});

test("plan and hypothesis rows are read the way Postgres reads them", () => {
  const plan = planFactsFromRow({
    status: "draft",
    origin: "manual",
    stale_at: null,
    objective: " objetivo ",
    // Postgres casts the text "true" like the JSON boolean.
    modalities: { acupuncture: { enabled: "true" }, cupping: { enabled: false }, moxibustion: { enabled: true, contraindicationChecklist: ["  ", null] } },
    safety_flags: [{ category: "pregnancy" }, { category: "anticoagulant" }],
  });
  assert.equal(plan.enabledModalities, 2);
  assert.equal(plan.hasObjective, true);
  assert.equal(plan.moxibustionChecklistFilled, false, "blank and null entries do not count");
  assert.equal(plan.safetyFlagCount, 2);

  assert.deepEqual(
    hypothesisFactsFromRows([
      { status: "draft", stale_at: null },
      { status: "draft", stale_at: "2026-09-10T10:00:00Z" },
      { status: "accepted", stale_at: null },
      { status: "edited", stale_at: "2026-09-10T10:00:00Z" },
      { status: "rejected", stale_at: null },
    ]),
    { draftFresh: 1, draftStale: 1, acceptedFresh: 1, acceptedStale: 1, rejected: 1 },
  );
});
