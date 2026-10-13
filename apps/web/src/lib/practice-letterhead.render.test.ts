import { renderAttendancePdf } from "./attendance-document";
import { describe, expect, it } from "vitest";

/**
 * Renders a real PDF, because the unit tests above only prove the helper builds
 * the right STRINGS — they cannot catch a style @react-pdf refuses or a header
 * that throws at render time, and the production build (the other thing that
 * would) is not always runnable here.
 *
 * The attendance certificate is the one chosen on purpose: it is the shortest
 * document, and the one whose privacy rule is strictest — it attests presence
 * and nothing else, so it is also where an accidental leak would matter most.
 */
const LABELS: Record<string, string> = {
  "attendance-title": "Declaração de comparecimento",
  "doc-cpf": "CPF",
  "doc-cnpj": "CNPJ",
};
const t = ((key: string) => LABELS[key] ?? key) as never;
const ctx = { verifyCode: "ABCD1234EFGH", verifyUrl: "https://example.test/verify/ABCD1234EFGH" } as never;

const base = {
  orgName: "Clínica da Debora",
  patientName: "Helena Martins",
  professionalName: "Debora Giovanella",
  professionalRegistration: "CNAA 3086",
  professionalTitle: "Acupunturista",
  issuedAt: "13/10/2026",
  consultationDate: "13/10/2026",
  version: 1,
} as never;

// Rendering a PDF costs seconds, not milliseconds — font loading plus layout.
// Vitest's 5s default passes in isolation and fails under the full suite, which
// is the worst kind of test: green alone, flaky together.
describe("the letterhead on a real PDF", { timeout: 30_000 }, () => {
  it("renders with the practice fully filled in", async () => {
    const pdf = await renderAttendancePdf(
      {
        ...(base as object),
        practice: {
          document: "12345678000195",
          phone: "62999887766",
          email: "contato@clinica.test",
          postalCode: "74000000",
          street: "Rua das Flores",
          number: "120",
          district: "Setor Central",
          city: "Goiânia",
          state: "GO",
        },
      } as never,
      t,
      ctx,
    );
    // A PDF starts with %PDF; anything else means the renderer threw or produced junk.
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("still renders for a practice that filled nothing", async () => {
    // The regression that matters: accounts older than the screen have every
    // practice column null, and they must keep issuing documents.
    const pdf = await renderAttendancePdf({ ...(base as object), practice: {} } as never, t, ctx);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("puts the identification INSIDE the file, not just beside it", async () => {
    // Rendering without throwing proves nothing about the lines reaching the
    // page. The filled document has to be materially heavier than the bare one
    // — that is the only cheap evidence the letterhead was actually drawn.
    const [filled, bare] = await Promise.all([
      renderAttendancePdf(
        {
          ...(base as object),
          practice: { document: "12345678000195", city: "Goiânia", state: "GO", phone: "62999887766" },
        } as never,
        t,
        ctx,
      ),
      renderAttendancePdf({ ...(base as object), practice: {} } as never, t, ctx),
    ]);
    expect(filled.byteLength).toBeGreaterThan(bare.byteLength);
  });
});
