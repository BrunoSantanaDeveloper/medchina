import { buildWebHandoff, destinationFromUrl } from "./mobile-navigation";

const id = "2f7bd1b2-27cb-4f80-8a46-5d29e270c89d";

describe("mobile navigation", () => {
  it("accepts only known consultation links", () => {
    expect(destinationFromUrl(`medchina://consulta/${id}`)).toBe(`/consulta/${id}`);
    expect(destinationFromUrl(`https://app.example.com/consultas/${id}`, "https://app.example.com")).toBe(
      `/consulta/${id}`,
    );
  });

  it("does not echo arbitrary schemes or hosts", () => {
    expect(destinationFromUrl(`https://evil.example/consultas/${id}`, "https://app.example.com")).toBeNull();
    expect(destinationFromUrl(`javascript:alert(1)`)).toBeNull();
  });

  it("builds web handoff from validated IDs rather than received URLs", () => {
    expect(buildWebHandoff("review", { consultationId: id }, "https://app.example.com")).toBe(
      `https://app.example.com/consultas/${id}?source=mobile`,
    );
    expect(buildWebHandoff("review", { consultationId: "../../billing" }, "https://app.example.com")).toBeNull();
  });
});
