import { describe, expect, it } from "vitest";

import { type ClinicalAiFeature, clinicalAiFloor, clinicalAiRoute, describeClinicalAiRouting } from "@/lib/ai-routing";
import { AiConfigurationError, clinicalProviderCode } from "@flyee/ai/errors";

const FEATURES: ClinicalAiFeature[] = ["extraction", "hypotheses", "plan", "summary", "attachment"];

/** A literal environment, as the routing reads it (Next types NODE_ENV as required). */
const asEnv = (env: Record<string, string>) => env as unknown as NodeJS.ProcessEnv;

const routeOf = (feature: ClinicalAiFeature, env: Record<string, string>) => clinicalAiRoute(feature, asEnv(env));

describe("clinicalAiRoute", () => {
  it("runs every feature on Gemini when nothing is configured", () => {
    for (const feature of FEATURES) {
      expect(routeOf(feature, {})).toMatchObject({ provider: "gemini", model: "gemini-3.6-flash" });
    }
    expect(routeOf("hypotheses", {}).effort).toBe("medium");
    expect(routeOf("summary", {}).effort).toBe("low");
  });

  it("keeps what a deployment configured before the per-feature variables existed", () => {
    // REASONING_MODEL alone moved the four reasoning features to another Gemini model.
    const env = { REASONING_MODEL: "gemini-3.8-flash", TRANSCRIBE_MODEL: "gemini-3.5-flash" };
    for (const feature of ["hypotheses", "plan", "summary", "attachment"] as const) {
      expect(routeOf(feature, env)).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash" });
    }
    // The extraction never followed REASONING_*: it runs on the transcription model.
    expect(routeOf("extraction", env)).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash" });
    expect(routeOf("extraction", { ...env, EXTRACTION_MODEL: "gemini-3.8-flash" }).model).toBe("gemini-3.8-flash");
  });

  it("moves one feature at a time, with that provider's own default model", () => {
    const env = { HYPOTHESES_PROVIDER: "anthropic", REASONING_MODEL: "gemini-3.8-flash" };
    // Never the Gemini id from another level.
    expect(routeOf("hypotheses", env)).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" });
    expect(routeOf("plan", env)).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash" });
  });

  it("never lets the shared variables move the summary or the attachment reading to Anthropic", () => {
    const env = { REASONING_PROVIDER: "anthropic", REASONING_MODEL: "claude-opus-5-5" };
    expect(routeOf("hypotheses", env)).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(routeOf("plan", env)).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
    for (const feature of ["summary", "attachment", "extraction"] as const) {
      expect(routeOf(feature, env)).toMatchObject({ provider: "gemini", model: "gemini-3.6-flash" });
    }
    // Their own variable can.
    expect(routeOf("summary", { ...env, SUMMARY_PROVIDER: "anthropic" }).provider).toBe("anthropic");
    // Another processor named in REASONING_* is still followed, as before.
    const openrouter = { REASONING_PROVIDER: "openrouter", REASONING_MODEL: "google/gemini-3.6-flash" };
    expect(routeOf("attachment", openrouter)).toMatchObject({ provider: "openrouter" });
  });

  it("takes the configured thinking depth and ignores one that does not exist", () => {
    expect(routeOf("hypotheses", { HYPOTHESES_PROVIDER: "anthropic", HYPOTHESES_EFFORT: "high" }).effort).toBe("high");
    expect(routeOf("hypotheses", { HYPOTHESES_PROVIDER: "anthropic", HYPOTHESES_EFFORT: "turbo" }).effort).toBe(
      "medium",
    );
  });

  it("names the variable when the configuration cannot work, instead of running something else", () => {
    expect(() => routeOf("plan", { PLAN_PROVIDER: "antropic" })).toThrow(/PLAN_PROVIDER="antropic"/);
    // A Gemini id left behind after the provider moved.
    expect(() =>
      routeOf("extraction", { EXTRACTION_PROVIDER: "anthropic", EXTRACTION_MODEL: "gemini-3.6-flash" }),
    ).toThrow(/EXTRACTION_MODEL="gemini-3.6-flash"/);
    // A Claude id with no provider named would be sent to Gemini.
    expect(() => routeOf("hypotheses", { HYPOTHESES_MODEL: "claude-sonnet-5-5" })).toThrow(/HYPOTHESES_MODEL/);
    // No default to fall back on.
    expect(() => routeOf("plan", { REASONING_PROVIDER: "openrouter" })).toThrow(/needs REASONING_MODEL/);
  });

  it("keeps the transcription model when the extraction names Gemini without a model", () => {
    const env = { EXTRACTION_PROVIDER: "gemini", TRANSCRIBE_MODEL: "gemini-3.5-flash" };
    expect(routeOf("extraction", env)).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash" });
  });
});

describe("what an operator types into the hosting dashboard", () => {
  it("reads provider and effort regardless of case and stray spaces", () => {
    expect(routeOf("extraction", { EXTRACTION_PROVIDER: " Anthropic ", EXTRACTION_EFFORT: "LOW " })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: "low",
    });
    expect(
      routeOf("extraction", { EXTRACTION_PROVIDER: "anthropic", EXTRACTION_MODEL: " claude-haiku-5-5 " }).model,
    ).toBe("claude-haiku-5-5");
  });

  it("raises a configuration error — never retryable — when the routing cannot work", () => {
    const attempt = () => routeOf("plan", { PLAN_PROVIDER: "antropic" });
    expect(attempt).toThrow(AiConfigurationError);
    try {
      attempt();
    } catch (error) {
      expect(clinicalProviderCode(error)).toBe("provider_rejected");
    }
  });
});

describe("the Gemini floor under a feature moved to another provider", () => {
  it("is the model the extraction ran before any routing variable — never the failed provider's id", () => {
    const env = { EXTRACTION_PROVIDER: "anthropic", EXTRACTION_MODEL: "claude-sonnet-5-5" };
    expect(clinicalAiFloor("extraction", asEnv(env))).toMatchObject({ provider: "gemini", model: "gemini-3.6-flash" });
    expect(clinicalAiFloor("extraction", asEnv({ ...env, TRANSCRIBE_MODEL: "gemini-3.5-flash" })).model).toBe(
      "gemini-3.5-flash",
    );
    // A non-Gemini id there is ignored rather than sent to Gemini.
    expect(clinicalAiFloor("hypotheses", asEnv({ REASONING_MODEL: "claude-opus-5-5" })).model).toBe("gemini-3.6-flash");
  });
});

describe("the routing the superadmin console shows", () => {
  it("lists every feature with its route, whether its key is set, and the extraction's floor", () => {
    const rows = describeClinicalAiRouting(
      { gemini: true, anthropic: false },
      asEnv({ EXTRACTION_PROVIDER: "anthropic", PLAN_PROVIDER: "nope" }),
    );
    expect(rows.map((row) => row.feature)).toEqual(["extraction", "hypotheses", "plan", "summary", "attachment"]);
    expect(rows[0]).toMatchObject({
      route: { provider: "anthropic", model: "claude-sonnet-5-5" },
      keyConfigured: false,
      floor: { provider: "gemini" },
    });
    expect(rows[1]).toMatchObject({ route: { provider: "gemini" }, keyConfigured: true });
    expect(rows[1].floor).toBeUndefined();
    expect(rows[2].route).toBeUndefined();
    expect(rows[2].error).toMatch(/PLAN_PROVIDER="nope"/);
  });
});
