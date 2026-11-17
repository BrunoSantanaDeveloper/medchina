import { resolveCampaignOffer } from "./campaign-offer";
import { describe, expect, it } from "vitest";

/**
 * The campaign offer decides what two public surfaces sell, so the cases that
 * matter here are the ones where a setting could quietly promise something the
 * checkout would refuse — or quietly rewrite the home.
 */
describe("resolveCampaignOffer", () => {
  it("reports a named cause instead of a bare closed flag", () => {
    expect(resolveCampaignOffer(null).reason).toBe("not_configured");
    expect(resolveCampaignOffer({ plan_slug: "pro-campanha" }).reason).toBe("disabled");
    expect(resolveCampaignOffer({ plan_slug: "pro-campanha", enabled: true }).reason).toBe("open");
    expect(
      resolveCampaignOffer({
        plan_slug: "pro-campanha",
        enabled: true,
        deadline: "2020-01-01T00:00:00.000Z",
      }).reason,
    ).toBe("expired");
  });

  it("never opens on the annual slug alone", () => {
    const offer = resolveCampaignOffer({ enabled: true, annual_plan_slug: "pro-campanha-anual" });
    expect(offer.reason).toBe("not_configured");
    expect(offer.closed).toBe(true);
  });

  it("drops a second slug that repeats the first, so one price is never shown twice", () => {
    const offer = resolveCampaignOffer({
      enabled: true,
      plan_slug: "pro-campanha",
      annual_plan_slug: "pro-campanha",
    });
    expect(offer.annualPlanSlug).toBeNull();
  });

  it("ignores an unparseable deadline rather than treating it as expired", () => {
    const offer = resolveCampaignOffer({ enabled: true, plan_slug: "pro-campanha", deadline: "ontem" });
    expect(offer.deadline).toBeNull();
    expect(offer.reason).toBe("open");
  });

  it("leaves the home on the catalogue unless the operator asked for the swap", () => {
    // A setting written before the switch existed has no such key: the home is
    // the trial-first front door and must not change because a campaign opened.
    expect(resolveCampaignOffer({ enabled: true, plan_slug: "pro-campanha" }).showOnHome).toBe(false);
    expect(resolveCampaignOffer({ enabled: true, plan_slug: "pro-campanha", show_on_home: true }).showOnHome).toBe(
      true,
    );
  });

  it("keeps showOnHome independent of closed, so the reader decides from both", () => {
    // The home swaps only when the offer is ALSO sellable. Folding that into
    // showOnHome would hide which of the two switches is off from the console.
    const closed = resolveCampaignOffer({ plan_slug: "pro-campanha", show_on_home: true });
    expect(closed.showOnHome).toBe(true);
    expect(closed.closed).toBe(true);
  });
});
