import { describe, expect, it } from "vitest";

import { INVOICE_DESCRIPTION_LIMIT, invoiceDescription } from "@flyee/billing/types";

/**
 * The "Descrição" on the invoice the customer pays.
 *
 * Built from `plans.description`, which a superadmin edits freely in
 * /admin/billing. Asaas refuses a subscription whose description exceeds 500
 * characters (measured), so whatever is typed there must never reach the
 * provider longer than that — otherwise every checkout of that plan fails at
 * the last step.
 */
const PRO_ANUAL = {
  name: "Pro anual",
  description:
    "Tudo do Assistente, mais a preparação do raciocínio terapêutico para sua validação e a revisão dos casos dos seus pacientes na biblioteca.",
};

describe("invoiceDescription", () => {
  it("puts the plan's name in front of what it includes", () => {
    expect(invoiceDescription(PRO_ANUAL)).toBe(
      "Pro anual — Tudo do Assistente, mais a preparação do raciocínio terapêutico para sua validação e a revisão dos casos dos seus pacientes na biblioteca.",
    );
  });

  it("falls back to the name when the plan has no description (pro-fundador has none today)", () => {
    expect(invoiceDescription({ name: "PRO FUNDADOR", description: null })).toBe("PRO FUNDADOR");
    expect(invoiceDescription({ name: "PRO FUNDADOR", description: "" })).toBe("PRO FUNDADOR");
    expect(invoiceDescription({ name: "PRO FUNDADOR", description: "   \n  " })).toBe("PRO FUNDADOR");
    expect(invoiceDescription({ name: "PRO FUNDADOR" })).toBe("PRO FUNDADOR");
  });

  it("collapses the line breaks an admin textarea produces", () => {
    expect(invoiceDescription({ name: "Pro", description: "Linha um.\n\n  Linha dois.\tFim." })).toBe(
      "Pro — Linha um. Linha dois. Fim.",
    );
  });

  it("never exceeds the provider's limit, however long the admin text is", () => {
    const result = invoiceDescription({ name: "Pro anual", description: "palavra ".repeat(200) });
    expect(result.length).toBe(INVOICE_DESCRIPTION_LIMIT);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves a description that fits exactly alone", () => {
    const name = "P";
    // "P — " is 4 characters; fill the rest to land exactly on the limit.
    const description = "x".repeat(INVOICE_DESCRIPTION_LIMIT - 4);
    const result = invoiceDescription({ name, description });
    expect(result.length).toBe(INVOICE_DESCRIPTION_LIMIT);
    expect(result.endsWith("…")).toBe(false);
  });

  it("names order-bump add-ons next to the plan", () => {
    expect(invoiceDescription({ name: "Pro", description: "Inclui X." }, ["Módulo A", "Módulo B"])).toBe(
      "Pro + Módulo A, Módulo B — Inclui X.",
    );
  });
});
