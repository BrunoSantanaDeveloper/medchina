import { resolveBillingWindow } from "./billing-window";
import { describe, expect, it } from "vitest";

const iso = (value: string) => new Date(value).toISOString();

describe("resolveBillingWindow", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("opens the first cycle at the charge's due date and closes it one period later", () => {
    const window = resolveBillingWindow(
      { status: "incomplete", period: "monthly", currentPeriodStart: null, currentPeriodEnd: null },
      { currentPeriodStart: new Date("2026-09-17") },
      now,
    );
    expect(window).toEqual({ start: iso("2026-09-17"), end: iso("2026-10-17"), renewed: false });
  });

  it("falls back to now when the provider names no cycle at all", () => {
    const window = resolveBillingWindow(
      { status: "incomplete", period: "monthly", currentPeriodStart: null, currentPeriodEnd: null },
      {},
      now,
    );
    expect(window.start).toBe(now.toISOString());
    expect(window.end).toBe(iso("2026-10-17T12:00:00Z"));
  });

  it("does not restart the window when the same charge is delivered twice (CONFIRMED then RECEIVED)", () => {
    const stored = {
      status: "active",
      period: "monthly" as const,
      currentPeriodStart: iso("2026-09-17"),
      currentPeriodEnd: iso("2026-10-17"),
    };
    const window = resolveBillingWindow(stored, { currentPeriodStart: new Date("2026-09-17") }, now);
    expect(window).toEqual({ start: stored.currentPeriodStart, end: stored.currentPeriodEnd, renewed: false });
  });

  it("does not restart the window on a cosmetic update that carries the SAME period (Stripe cancel/undo)", () => {
    const stored = {
      status: "active",
      period: "monthly" as const,
      currentPeriodStart: iso("2026-09-01"),
      currentPeriodEnd: iso("2026-10-01"),
    };
    const window = resolveBillingWindow(
      stored,
      { currentPeriodStart: new Date("2026-09-01"), currentPeriodEnd: new Date("2026-10-01") },
      new Date("2026-09-20T00:00:00Z"),
    );
    expect(window.renewed).toBe(false);
    expect(window.start).toBe(stored.currentPeriodStart);
    expect(window.end).toBe(stored.currentPeriodEnd);
  });

  it("ADVANCES the window on an Asaas renewal, which carries only the next charge's due date", () => {
    // This is the case that used to freeze the window on month one and meter
    // the workspace as unlimited once that month had passed.
    const stored = {
      status: "active",
      period: "monthly" as const,
      currentPeriodStart: iso("2026-09-17"),
      currentPeriodEnd: iso("2026-10-17"),
    };
    const window = resolveBillingWindow(
      stored,
      { currentPeriodStart: new Date("2026-10-17") },
      new Date("2026-10-18T09:00:00Z"),
    );
    expect(window).toEqual({ start: iso("2026-10-17"), end: iso("2026-11-17"), renewed: true });
  });

  it("advances the window on a Stripe renewal that names both ends", () => {
    const stored = {
      status: "active",
      period: "monthly" as const,
      currentPeriodStart: iso("2026-09-01"),
      currentPeriodEnd: iso("2026-10-01"),
    };
    const window = resolveBillingWindow(
      stored,
      { currentPeriodStart: new Date("2026-10-01"), currentPeriodEnd: new Date("2026-11-01") },
      new Date("2026-10-01T03:00:00Z"),
    );
    expect(window).toEqual({ start: iso("2026-10-01"), end: iso("2026-11-01"), renewed: true });
  });

  it("re-anchors a past_due recovery on the paid charge's cycle instead of keeping the stale end", () => {
    const stored = {
      status: "past_due",
      period: "monthly" as const,
      currentPeriodStart: iso("2026-08-17"),
      currentPeriodEnd: iso("2026-09-17"),
    };
    const window = resolveBillingWindow(
      stored,
      { currentPeriodStart: new Date("2026-09-17") },
      new Date("2026-09-22T00:00:00Z"),
    );
    expect(window).toEqual({ start: iso("2026-09-17"), end: iso("2026-10-17"), renewed: true });
  });

  it("gives a live subscription with no recorded window one from now, without restarting anything later", () => {
    const stored = { status: "active", period: "monthly" as const, currentPeriodStart: null, currentPeriodEnd: null };
    const window = resolveBillingWindow(stored, {}, now);
    expect(window).toEqual({ start: now.toISOString(), end: iso("2026-10-17T12:00:00Z"), renewed: false });
  });
});
