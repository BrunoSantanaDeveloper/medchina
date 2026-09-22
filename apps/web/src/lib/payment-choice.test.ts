import { resolvePaymentChoice } from "./payment-choice";
import { describe, expect, it } from "vitest";

describe("resolvePaymentChoice", () => {
  it("passes a card purchase on an annual plan through with its instalments", () => {
    expect(resolvePaymentChoice({ method: "credit_card", installments: 5, planPeriod: "yearly" })).toEqual({
      method: "credit_card",
      installments: 5,
    });
  });

  it("clamps a crafted request to the instalments actually on offer", () => {
    // The grid shows 5; a hand-made request asking for 12 must not open a 12x
    // checkout just because nothing in the browser stopped it.
    expect(resolvePaymentChoice({ method: "credit_card", installments: 12, planPeriod: "yearly" }).installments).toBe(
      5,
    );
    expect(resolvePaymentChoice({ method: "credit_card", installments: 0, planPeriod: "yearly" }).installments).toBe(1);
    expect(resolvePaymentChoice({ method: "credit_card", installments: -3, planPeriod: "yearly" }).installments).toBe(
      1,
    );
  });

  it("refuses to split a MONTHLY plan — that would sell a year of cycles for one month", () => {
    expect(resolvePaymentChoice({ method: "credit_card", installments: 5, planPeriod: "monthly" }).installments).toBe(
      1,
    );
  });

  it("refuses to split a Pix purchase, which Asaas would turn into five manual charges", () => {
    expect(resolvePaymentChoice({ method: "pix", installments: 5, planPeriod: "yearly" })).toEqual({
      method: "pix",
      installments: 1,
    });
  });

  it("ignores a method it does not know instead of forwarding it to the provider", () => {
    // `undefined` means "the provider decides", which is the behaviour that
    // shows boleto — so an unknown string must never become a method, but it
    // must also not crash the purchase.
    expect(resolvePaymentChoice({ method: "boleto", installments: 1, planPeriod: "yearly" }).method).toBeUndefined();
    expect(resolvePaymentChoice({ method: null, installments: 1, planPeriod: "monthly" }).method).toBeUndefined();
  });

  it("survives junk in the instalment field", () => {
    expect(
      resolvePaymentChoice({ method: "credit_card", installments: Number.NaN, planPeriod: "yearly" }).installments,
    ).toBe(1);
    expect(resolvePaymentChoice({ method: "credit_card", installments: 2.9, planPeriod: "yearly" }).installments).toBe(
      2,
    );
  });

  it("does not split a plan with no period — a minute pack is a small one-off, not a financed purchase", () => {
    expect(resolvePaymentChoice({ method: "credit_card", installments: 3, planPeriod: null }).installments).toBe(1);
  });
});
