import { parseTranscriptResult, transcriptTimestampSeconds } from "./transcript";
import { describe, expect, it } from "vitest";

describe("transcript contracts", () => {
  it("keeps only complete, reviewable segments", () => {
    expect(
      parseTranscriptResult({
        language: "pt-BR",
        segments: [
          { speaker: "Profissional", start: "00:04", text: "Como está o sono?" },
          { speaker: "Paciente", start: "00:08", text: "" },
          { speaker: "Paciente", text: "Sem timestamp" },
        ],
      }),
    ).toEqual({
      language: "pt-BR",
      segments: [{ speaker: "Profissional", start: "00:04", text: "Como está o sono?" }],
    });
  });

  it("converts transcript timestamps without trusting malformed values", () => {
    expect(transcriptTimestampSeconds("01:15")).toBe(75);
    expect(transcriptTimestampSeconds("01:02:03")).toBe(3723);
    expect(transcriptTimestampSeconds("invalid")).toBe(0);
  });
});
