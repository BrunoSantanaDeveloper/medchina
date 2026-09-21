import { describe, expect, it } from "vitest";

import { packCheckoutReference, parseCheckoutReference } from "@flyee/billing/types";

/**
 * The field that silently blocked every Asaas sale.
 *
 * Asaas rejects an `externalReference` longer than 100 characters
 * (`invalid_externalReference`, measured against the API — 100 passes, 101
 * does not). The JSON encoding this replaced produced 177, so the provider
 * refused the charge before the customer ever reached a payment page, and the
 * app reported the generic "unavailable".
 */
const ORG = "48ef0404-7385-4fd7-8727-3bd9b985eb76";
const PLAN = "31f5c803-90a7-403d-a849-127e612ae4e0";
const COUPON = "c254488f-46d4-4c97-95a2-62f63ae9e8ed";

const ASAAS_LIMIT = 100;

describe("packCheckoutReference", () => {
  it("fits Asaas's 100-character limit even with a coupon", () => {
    const withCoupon = packCheckoutReference({ org_id: ORG, plan_id: PLAN, coupon_id: COUPON });
    expect(withCoupon.length).toBeLessThanOrEqual(ASAAS_LIMIT);
    // The headroom is the point: pinned so a fourth field cannot be added
    // without this test refusing it.
    expect(withCoupon.length).toBe(98);
  });

  it("is shorter still without a coupon", () => {
    expect(packCheckoutReference({ org_id: ORG, plan_id: PLAN }).length).toBe(65);
  });

  it("round-trips the ids the webhook reads", () => {
    const packed = packCheckoutReference({ org_id: ORG, plan_id: PLAN, coupon_id: COUPON });
    expect(parseCheckoutReference(packed)).toEqual({ org_id: ORG, plan_id: PLAN, coupon_id: COUPON });
  });

  it("round-trips without a coupon and reports no coupon at all", () => {
    const packed = packCheckoutReference({ org_id: ORG, plan_id: PLAN });
    expect(parseCheckoutReference(packed)).toEqual({ org_id: ORG, plan_id: PLAN });
  });

  it("still reads a charge created under the legacy JSON encoding", () => {
    const legacy = JSON.stringify({ org_id: ORG, plan_id: PLAN, module_ids: "", billing_operation_key: "k" });
    expect(parseCheckoutReference(legacy)).toMatchObject({ org_id: ORG, plan_id: PLAN });
  });

  it("returns nothing for a reference typed by hand in the Asaas panel", () => {
    // These arrive on every webhook of the account and must be skippable, not
    // read as a malformed org id.
    expect(parseCheckoutReference("056984")).toEqual({});
    expect(parseCheckoutReference("pedido 12")).toEqual({});
    expect(parseCheckoutReference("")).toEqual({});
    expect(parseCheckoutReference(null)).toEqual({});
    expect(parseCheckoutReference("[1,2,3]")).toEqual({});
    expect(parseCheckoutReference("42")).toEqual({});
  });

  it("does not mistake a dotted string of the wrong shape for a packed reference", () => {
    expect(parseCheckoutReference("abc.def")).toEqual({});
    expect(parseCheckoutReference(`${"a".repeat(32)}.${"z".repeat(32)}`)).toEqual({});
  });
});
