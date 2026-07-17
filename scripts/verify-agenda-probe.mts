/** Focused probe: locate every button whose accessible name is "Agendar consulta". */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "playwright";

const SHOTS = resolve(
  "C:/Users/tribo/AppData/Local/Temp/claude/c--AppsProjects-medchina/dc369cbd-1488-415b-b2ce-91ba7d02be94/scratchpad",
  "agenda-walk",
);
void readFileSync;
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const page = await ctx.newPage();
await page.goto("http://localhost:3010/auth/sign-in", { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.locator('input[type="email"]').first().fill("verify-agenda@medchina.dev");
await page.locator('input[type="password"]').first().fill("Verify!Agenda2026#mc");
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 90_000 });
await page.goto("http://localhost:3010/agenda", { waitUntil: "domcontentloaded", timeout: 90_000 });
try {
  await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 30_000 });
} catch {
  console.log(`URL atual: ${page.url()}`);
  console.log(`Texto da página: ${JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 600))}`);
  await page.screenshot({ path: resolve(SHOTS, "probe-estado.png"), fullPage: true });
}

const info = await page.getByRole("button", { name: "Agendar consulta" }).evaluateAll((els) =>
  els.map((el) => {
    const rect = (el as HTMLElement).getBoundingClientRect();
    const chain: string[] = [];
    let node: HTMLElement | null = el as HTMLElement;
    for (let depth = 0; node && depth < 8; depth++) {
      chain.push(`${node.tagName.toLowerCase()}${node.className ? "." + String(node.className).split(" ")[0] : ""}`);
      node = node.parentElement;
    }
    return {
      html: (el as HTMLElement).outerHTML,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      ancestors: chain.join(" < "),
    };
  }),
);
console.log(JSON.stringify(info, null, 2));
await browser.close();
