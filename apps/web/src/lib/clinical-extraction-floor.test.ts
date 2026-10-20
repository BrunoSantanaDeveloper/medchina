import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiSpendContext } from "@/lib/ai-spend";
import { extractAnamnesis } from "@/lib/clinical-extraction";
import {
  AiConfigurationError,
  clinicalProviderCode,
  describeAiFailure,
  isStructuredOutputError,
} from "@flyee/ai/errors";
import type { TranscriptResult } from "@flyee/transcribe";

/**
 * The extraction moved to Claude keeps Gemini as its floor: the transcription
 * already went there, so a draft made on Gemini when Claude refuses the call
 * adds no processor — and leaves the professional a chart instead of an error.
 * These pin when the floor runs, what it records, and what is billed.
 */
const generateStructured = vi.fn();
const generateContent = vi.fn();

vi.mock("@flyee/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flyee/ai")>();
  return { ...actual, getChatProvider: () => ({ generateStructured }) };
});
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const TRANSCRIPT: TranscriptResult = {
  language: "pt-BR",
  segments: [
    { speaker: "Speaker 1", start: "00:05", text: "Como tem sido o seu sono?" },
    { speaker: "Speaker 2", start: "00:09", text: "Durmo mal, acordo sempre por volta das três da manhã." },
  ],
};

/** A reply every provider could give: one answer, quoted verbatim. */
const REPLY = {
  practitionerSpeaker: "Speaker 1",
  answers: [
    {
      field: "routine.sleep",
      value: "Acorda por volta das três da manhã",
      source: "patient_report",
      state: "clear",
      quote: "acordo sempre por volta das três da manhã",
      start: "00:09",
      speaker: "Speaker 2",
    },
  ],
  gaps: [],
};

/** Billing rows written through the spend context, as the ledger would receive them. */
function ledger() {
  const rows: { provider: string; model: string; tokensIn: number }[] = [];
  const spend: AiSpendContext = {
    orgId: "00000000-0000-0000-0000-000000000001",
    refId: "00000000-0000-0000-0000-000000000002",
    client: {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        rows.push({
          provider: String(args.target_provider),
          model: String(args.target_model),
          tokensIn: Number(args.target_tokens_in),
        });
        return { data: null, error: null };
      },
    } as unknown as AiSpendContext["client"],
  };
  return { rows, spend };
}

const geminiAnswers = () =>
  generateContent.mockResolvedValue({
    text: JSON.stringify(REPLY),
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120, thoughtsTokenCount: 30 },
  });

const ENV_KEYS = ["EXTRACTION_PROVIDER", "EXTRACTION_MODEL", "GEMINI_API_KEY", "TRANSCRIBE_MODEL"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.EXTRACTION_PROVIDER = "anthropic";
  delete process.env.EXTRACTION_MODEL;
  delete process.env.TRANSCRIBE_MODEL;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  generateStructured.mockReset();
  generateContent.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the anamnesis extraction on Claude, with Gemini as its floor", () => {
  it("drafts on Claude when Claude answers, and bills Claude", async () => {
    generateStructured.mockImplementation(async (_config, _messages, _output, sink) => {
      sink({ tokensIn: 1000, tokensOut: 200, model: "claude-sonnet-5-5" });
      return REPLY;
    });
    const { rows, spend } = ledger();

    const result = await extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false }, spend);

    expect(result.model).toBe("claude-sonnet-5-5");
    expect(result.fallbackFrom).toBeNull();
    expect(result.answers).toHaveLength(1);
    expect(generateStructured.mock.calls[0][0]).toMatchObject({ provider: "anthropic", effort: "low" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(rows).toEqual([{ provider: "anthropic", model: "claude-sonnet-5-5", tokensIn: 1000 }]);
  });

  it("falls to the Gemini floor when Claude refuses the call, billing both attempts", async () => {
    generateStructured.mockImplementation(async (_config, _messages, _output, sink) => {
      // Reported before the failure, as the provider does: the refused call was billed.
      sink({ tokensIn: 1000, tokensOut: 0, model: "claude-sonnet-5-5" });
      throw Object.assign(new Error("401 invalid x-api-key"), { status: 401 });
    });
    geminiAnswers();
    const { rows, spend } = ledger();

    const result = await extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false }, spend);

    expect(result.model).toBe("gemini-3.6-flash");
    expect(result.fallbackFrom).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", reason: "HTTP 401" });
    // The same verification holds on the floor: the quote was found, so the answer stays.
    expect(result.answers.map((answer) => answer.fieldKey)).toEqual(["sleep"]);
    expect(rows).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5-5", tokensIn: 1000 },
      { provider: "gemini", model: "gemini-3.6-flash", tokensIn: 900 },
    ]);
  });

  it("runs the floor on the transcription model, never on the failed provider's model id", async () => {
    process.env.EXTRACTION_MODEL = "claude-haiku-5-5";
    process.env.TRANSCRIBE_MODEL = "gemini-3.5-flash";
    generateStructured.mockRejectedValue(Object.assign(new Error("overloaded"), { status: 529 }));
    geminiAnswers();

    const result = await extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false });

    expect(generateContent.mock.calls[0][0]).toMatchObject({ model: "gemini-3.5-flash" });
    expect(result.fallbackFrom).toMatchObject({ model: "claude-haiku-5-5", reason: "HTTP 529" });
  });

  it("lets the failure stand when the stage's time is spent — the pipeline retries the whole stage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    generateStructured.mockImplementation(async () => {
      // The call ran 80 of the stage's 90 seconds before failing.
      vi.setSystemTime(Date.now() + 80_000);
      throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    });

    await expect(extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false })).rejects.toThrow(
      "Request timed out.",
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("has no floor without a Gemini key, and returns Claude's own failure", async () => {
    delete process.env.GEMINI_API_KEY;
    generateStructured.mockRejectedValue(Object.assign(new Error("429 rate limited"), { status: 429 }));

    await expect(extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false })).rejects.toMatchObject({
      status: 429,
    });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("drafts on the floor, never on the misrouted provider, when the routing cannot work", async () => {
    // The likeliest slip when switching: a Gemini id left in EXTRACTION_MODEL.
    process.env.EXTRACTION_MODEL = "gemini-3.6-flash";
    geminiAnswers();

    const result = await extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false });

    expect(generateStructured).not.toHaveBeenCalled();
    expect(result.model).toBe("gemini-3.6-flash");
    // A fixed reason: the message quoting the variable stays in the server log and /admin/ai.
    expect(result.fallbackFrom).toEqual({
      provider: "anthropic",
      model: "gemini-3.6-flash",
      reason: "routing_invalid",
    });
  });

  it("never writes what was pasted into the variable to the tenant-readable record", async () => {
    // transcriptions.metadata reaches the professional's browser.
    process.env.EXTRACTION_MODEL = "sk-ant-api03-PASTED-BY-MISTAKE";
    geminiAnswers();

    const result = await extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false });

    expect(result.fallbackFrom).toEqual({ provider: "anthropic", model: "(invalid)", reason: "routing_invalid" });
    expect(JSON.stringify(result)).not.toContain("PASTED-BY-MISTAKE");
  });

  it("gives the floor its turn after a slow Claude call when the PIPELINE still has time", async () => {
    // A retry: the transcript is ready and most of the invocation is free, but
    // Claude used up the stage's 90 s. The floor must not be starved by it.
    vi.useFakeTimers({ toFake: ["Date"] });
    generateStructured.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 91_000);
      throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
    });
    geminiAnswers();

    const result = await extractAnamnesis(TRANSCRIPT, Date.now() + 248_000, [], { fertilityCare: false });

    expect(result.model).toBe("gemini-3.6-flash");
    expect(result.fallbackFrom).toMatchObject({ provider: "anthropic", reason: "APIUserAbortError" });
  });

  it("keeps a refusal retryable when this invocation has no time left for the floor", async () => {
    // The next attempt starts with the transcript ready and a full budget —
    // ending the recording here on a dead key would deny it the floor.
    generateStructured.mockRejectedValue(Object.assign(new Error("401 invalid x-api-key"), { status: 401 }));

    const failure = await extractAnamnesis(TRANSCRIPT, Date.now() + 10_000, [], { fertilityCare: false }).catch(
      (error: unknown) => error,
    );

    expect(generateContent).not.toHaveBeenCalled();
    expect(clinicalProviderCode(failure)).toBe("provider_unavailable");
    expect((failure as Error).cause).toMatchObject({ status: 401 });
  });

  it("reports a malformed Gemini reply without quoting it — the log would carry the patient's record", async () => {
    delete process.env.EXTRACTION_PROVIDER;
    generateContent.mockResolvedValue({ text: '{"answers": [{"value": "Dorme mal desde o luto' });

    const failure = await extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false }).catch(
      (error: unknown) => error,
    );

    expect(isStructuredOutputError(failure)).toBe(true);
    expect(JSON.stringify(describeAiFailure(failure))).not.toContain("luto");
    expect(clinicalProviderCode(failure)).toBe("provider_unavailable");
  });

  it("still fails loudly when there is no floor to draft on", async () => {
    process.env.EXTRACTION_MODEL = "gemini-3.6-flash";
    delete process.env.GEMINI_API_KEY;

    await expect(extractAnamnesis(TRANSCRIPT, undefined, [], { fertilityCare: false })).rejects.toBeInstanceOf(
      AiConfigurationError,
    );
    expect(generateStructured).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });
});
