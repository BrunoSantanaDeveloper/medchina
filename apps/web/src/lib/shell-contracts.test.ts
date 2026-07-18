import { describe, expect, it } from "vitest";

import { PRODUCT_ACTIONS } from "@/lib/product-actions";
import { leftMenuBottomItems, leftMenuItems } from "@/menu-items";

describe("production shell contracts", () => {
  it("keeps the primary navigation focused on real product jobs", () => {
    expect(leftMenuItems.map((item) => item.id)).toEqual([
      "inicio",
      "pacientes",
      "agenda",
      "biblioteca",
      "primeiros-passos",
      "admin",
    ]);
    expect(leftMenuItems.find((item) => item.id === "admin")?.superadminOnly).toBe(true);
    expect(leftMenuBottomItems.map((item) => item.id)).toEqual(["settings"]);
  });

  it("exposes only unique internal destinations in the action registry", () => {
    const ids = PRODUCT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of PRODUCT_ACTIONS) {
      expect(action.href.startsWith("/")).toBe(true);
      expect(action.href.startsWith("//")).toBe(false);
      expect(action.href).not.toMatch(/^\/(ui|docs|applications)(\/|$)/);
    }
  });

  it("keeps the permanent getting-started hub reachable from actions", () => {
    expect(PRODUCT_ACTIONS).toContainEqual(
      expect.objectContaining({ id: "getting-started", href: "/primeiros-passos" }),
    );
  });
});
