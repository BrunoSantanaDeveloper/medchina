import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public home and authentication remain reachable without remote data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  await page.goto("/auth/sign-in");
  await expect(page.locator("body")).toContainText(/entrar|acessar|sign in/i);
});

test("protected product routes preserve the intended destination through authentication", async ({ page }) => {
  for (const route of ["/primeiros-passos", "/agenda", "/pacientes", "/settings/preferences"]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/auth/sign-in\\?next=${encodeURIComponent(route)}`));
    await expect(page.getByRole("heading", { name: /entrar|sign in/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /relation .* does not exist|postgres|\[object Object\]|undefined/i,
    );
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("@a11y core entry and product routes have no critical axe violations", async ({ page }) => {
  for (const route of [
    "/auth/sign-in",
    "/auth/sign-up",
    "/auth/password-reset",
    "/primeiros-passos",
    "/agenda",
    "/pacientes",
    "/settings/preferences",
  ]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const critical = results.violations.filter((violation) => violation.impact === "critical");
    expect(critical, `Critical accessibility violations at ${route}`).toEqual([]);
  }
});
