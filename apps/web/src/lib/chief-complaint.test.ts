import { complaintOnOneLine, complaintTitle } from "./chief-complaint";
import { describe, expect, it } from "vitest";

const STORY = "Dor lombar há 3 meses\n\n  Piora ao acordar e melhora com calor  \nJá fez fisioterapia";

describe("a chief complaint written over several lines", () => {
  it("keeps every line, on one line, for prompts that list one fact per line", () => {
    expect(complaintOnOneLine(STORY)).toBe(
      "Dor lombar há 3 meses / Piora ao acordar e melhora com calor / Já fez fisioterapia",
    );
  });

  it("uses the first line as the title of the case", () => {
    expect(complaintTitle(STORY)).toBe("Dor lombar há 3 meses");
    expect(complaintTitle("\n\n  Insônia  \nacorda às 3h")).toBe("Insônia");
  });

  it("caps a very long first line instead of flooding a search or a listing", () => {
    const title = complaintTitle("x".repeat(500), 200);
    expect(title.length).toBe(201);
    expect(title.endsWith("…")).toBe(true);
  });

  it("is empty for nothing, never the text 'null'", () => {
    expect(complaintOnOneLine(null)).toBe("");
    expect(complaintTitle(undefined)).toBe("");
    expect(complaintTitle("   \n  ")).toBe("");
  });
});
