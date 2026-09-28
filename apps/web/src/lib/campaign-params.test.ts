import { decodeCampaignCookie, encodeCampaignCookie, hasCampaign, pickCampaignParams } from "./campaign-params";
import { describe, expect, it } from "vitest";

describe("pickCampaignParams", () => {
  it("keeps only the allowlisted keys, cleaned and bounded", () => {
    expect(
      pickCampaignParams({
        utm_source: " instagram ",
        utm_campaign: ["lei-15345", "segundo"],
        utm_content: "x".repeat(80),
        fbclid: "nope",
        origem: "evento\u0000",
      }),
    ).toEqual({ utm_source: "instagram", utm_campaign: "lei-15345", utm_content: "x".repeat(64), origem: "evento" });
    expect(hasCampaign(pickCampaignParams({ fbclid: "x" }))).toBe(false);
  });
});

describe("last-touch campaign cookie", () => {
  it("round-trips the campaign", () => {
    const campaign = { utm_source: "email", utm_campaign: "lei-15345", utm_content: "china-lei-15345-email" };
    expect(decodeCampaignCookie(encodeCampaignCookie(campaign))).toEqual(campaign);
  });
  it("re-validates on the way back: a cookie is client input", () => {
    const forged = encodeURIComponent(JSON.stringify({ utm_source: "a\u0007b", evil: "x", origem: "y".repeat(90) }));
    expect(decodeCampaignCookie(forged)).toEqual({ utm_source: "ab", origem: "y".repeat(64) });
  });
  it("reads garbage as no campaign", () => {
    expect(decodeCampaignCookie("%E0%A4%A")).toEqual({});
    expect(decodeCampaignCookie("not-json")).toEqual({});
    expect(decodeCampaignCookie(encodeURIComponent("[1,2]"))).toEqual({});
    expect(decodeCampaignCookie(null)).toEqual({});
  });
});
