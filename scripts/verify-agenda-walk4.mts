/**
 * Temporary product-verify walk 4 — only the journeys still unverified after
 * runs 1-3 (J9, M1, J2-J4, P2 already proven). Defensive against dev-server
 * flakiness: generous timeouts, empty-page reload, dialog cleanup per step.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { chromium, type Locator, type Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const BASE = "http://localhost:3010";
const SHOTS = resolve(
  "C:/Users/tribo/AppData/Local/Temp/claude/c--AppsProjects-medchina/dc369cbd-1488-415b-b2ce-91ba7d02be94/scratchpad",
  "agenda-walk",
);
mkdirSync(SHOTS, { recursive: true });

for (const line of readFileSync(resolve(ROOT, "apps/web/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let value = m[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!(m[1] in process.env) && value) process.env[m[1]] = value;
}

const EMAIL = "verify-agenda@medchina.dev";
const NEW_EMAIL = "verify-agenda-new@medchina.dev";
const PASSWORD = "Verify!Agenda2026#mc";
const TZ = "America/Sao_Paulo";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const { data: seedUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const seedUserId = seedUsers!.users.find((u) => u.email === EMAIL)!.id;
const { data: membership } = await admin.from("memberships").select("org_id").eq("user_id", seedUserId).limit(1);
const orgId = membership![0].org_id as string;
const { data: patients } = await admin.from("patients").select("id, full_name").eq("org_id", orgId);
const maria = patients!.find((p) => p.full_name === "Maria Souza Lima")!;
const { data: consultations } = await admin
  .from("consultations")
  .select("id, status, scheduled_for, duration_minutes, patient_id")
  .eq("org_id", orgId)
  .order("scheduled_for");
const mariaToday = consultations!.find((c) => c.patient_id === maria.id && c.status === "scheduled")!;
const mariaStart = new Date(mariaToday.scheduled_for as string);
const conflictAt = new Date(mariaStart.getTime() + 10 * 60_000);
const lastEnd = consultations!
  .filter((c) => c.status !== "cancelled")
  .reduce((max, c) => {
    const end = new Date(c.scheduled_for as string).getTime() + (c.duration_minutes as number) * 60_000;
    return Math.max(max, end);
  }, 0);
const todayFree = new Date(Math.max(lastEnd, Date.now()) + 45 * 60_000);

const fmtDigits = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.day}${v.month}${v.year}${v.hour}${v.minute}`;
};

type StepResult = { id: string; name: string; ok: boolean; err?: string };
const results: StepResult[] = [];
let current: Page | null = null;
async function step(id: string, name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ id, name, ok: true });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({ id, name, ok: false, err: String(error).slice(0, 300) });
    console.log(`FAIL ${id} ${name} :: ${String(error).slice(0, 240)}`);
    try {
      if (current && !current.isClosed()) {
        await current.screenshot({ path: resolve(SHOTS, `fail4-${id}.png`), fullPage: true });
      }
    } catch {
      /* evidence only */
    }
  }
  // Leave no dialog behind for the next step.
  try {
    if (current && !current.isClosed() && (await current.getByRole("dialog").count())) {
      await current.keyboard.press("Escape");
      await current.waitForTimeout(400);
    }
  } catch {
    /* best effort */
  }
}

const shot = (p: Page, name: string) => p.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });

async function robustGoto(p: Page, url: string) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const size = await p.evaluate(() => document.body.innerText.length);
    if (size > 0) return;
    console.log(`  [goto] página vazia (tentativa ${attempt + 1}) — recarregando`);
    await p.waitForTimeout(2_000);
    await p.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  }
}

async function login(p: Page, email: string) {
  await robustGoto(p, `${BASE}/auth/sign-in`);
  await p.locator('input[type="email"]').first().fill(email, { timeout: 60_000 });
  await p.locator('input[type="password"]').first().fill(PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (!new URL(p.url()).pathname.startsWith("/auth")) return;
    const alert = p.locator(".MuiAlert-root");
    if (await alert.count()) {
      throw new Error(`login não navegou; alerta: ${JSON.stringify((await alert.first().textContent())?.slice(0, 160))}`);
    }
    if (Date.now() > deadline) throw new Error(`login não navegou em 120s (url: ${p.url()})`);
    await p.waitForTimeout(500);
  }
}

async function setDateTime(scope: Locator, digits: string) {
  const p = scope.page();
  const input = scope.getByLabel(/Data e hora/).first();
  await input.click();
  await p.keyboard.press("Control+a");
  await p.keyboard.type(digits, { delay: 40 });
}

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
  locale: "pt-BR",
  timezoneId: TZ,
});
const page = await desktop.newPage();
page.setDefaultTimeout(30_000);
current = page;

await step("W0", "login e agenda prontos", async () => {
  await login(page, EMAIL);
  await robustGoto(page, `${BASE}/agenda`);
  await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 90_000 });
});

await step("W1", "fantasma: quem é o segundo botão 'Agendar consulta'", async () => {
  const info = await page.getByRole("button", { name: "Agendar consulta" }).evaluateAll((els) =>
    els.map((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const chain: string[] = [];
      let node: HTMLElement | null = el as HTMLElement;
      for (let depth = 0; node && depth < 10; depth++) {
        chain.push(node.tagName.toLowerCase() + (node.getAttribute("aria-label") ? `[aria=${node.getAttribute("aria-label")}]` : ""));
        node = node.parentElement;
      }
      return { html: (el as HTMLElement).outerHTML.slice(0, 400), rect, ancestors: chain.join(" < ") };
    }),
  );
  console.log(`  [W1] ${JSON.stringify(info, null, 1)}`);
});

await step("W2", "agendar: desvio criar-paciente preserva contexto", async () => {
  await page.getByRole("button", { name: "Agendar consulta" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Observação do agendamento/).fill("Verificação de contexto");
  await dialog.getByRole("combobox", { name: "Duração" }).click();
  await page.getByRole("option", { name: "90 min" }).click();
  await shot(page, "07-dialogo-preenchido");
  await dialog.getByRole("button", { name: "Cadastrar novo paciente aqui" }).click();
  const headings = await dialog.getByText("Novo paciente").count();
  console.log(`  [W2] título 'Novo paciente' aparece ${headings}x no diálogo`);
  await dialog.getByLabel("Nome completo").fill("Pedro Álvares Verificação");
  await shot(page, "08-desvio-novo-paciente");
  await dialog.getByRole("button", { name: "Cadastrar e selecionar" }).click();
  await dialog.getByLabel("Paciente *").waitFor();
  const patientValue = await dialog.getByLabel("Paciente *").inputValue();
  if (patientValue !== "Pedro Álvares Verificação") throw new Error(`paciente não selecionado: "${patientValue}"`);
  const noteValue = await dialog.getByLabel(/Observação do agendamento/).inputValue();
  if (noteValue !== "Verificação de contexto") throw new Error(`observação perdida: "${noteValue}"`);
  const duration = await dialog.getByRole("combobox", { name: "Duração" }).textContent();
  if (!duration?.includes("90")) throw new Error(`duração perdida: "${duration}"`);
  await shot(page, "09-contexto-preservado");

  // Conflict path in the same open dialog.
  await setDateTime(dialog, fmtDigits(conflictAt));
  await dialog.getByRole("button", { name: "Agendar", exact: true }).click();
  await dialog.getByText(/nesse horário/).waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Agendar mesmo assim" }).waitFor();
  await shot(page, "10-conflito");
  await setDateTime(dialog, fmtDigits(todayFree));
  await dialog.getByRole("button", { name: "Agendar", exact: true }).click();
  await page.getByText("Consulta agendada.").waitFor({ timeout: 20_000 });
  await shot(page, "11-agendada-snackbar");
});

await step("W3", "reagendar preenche contexto e confirma", async () => {
  await page.getByRole("button", { name: "Próximas" }).click();
  await page.getByText("Pedro Álvares Verificação").first().waitFor();
  await page.getByRole("button", { name: /Reagendar consulta de Pedro Álvares Verificação/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Reagendar consulta").waitFor();
  const patientValue = await dialog.getByLabel("Paciente *").inputValue();
  if (patientValue !== "Pedro Álvares Verificação") throw new Error(`paciente não preenchido: "${patientValue}"`);
  const tomorrow10 = new Date();
  tomorrow10.setDate(tomorrow10.getDate() + 1);
  tomorrow10.setHours(10, 0, 0, 0);
  await setDateTime(dialog, fmtDigits(tomorrow10));
  await shot(page, "12-reagendar");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await page.getByText("Agendamento atualizado.").waitFor({ timeout: 20_000 });
  await shot(page, "13-reagendado");
});

await step("W4", "cancelar confirma consequência + desfazer restaura", async () => {
  await page.getByRole("button", { name: /Cancelar agendamento de Pedro Álvares Verificação/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Cancelar este agendamento?").waitFor();
  await dialog.getByText(/O horário de Pedro Álvares Verificação/).waitFor();
  await dialog.getByLabel(/Motivo/).fill("Teste de desfazer");
  await shot(page, "14-cancelar-confirmacao");
  await dialog.getByRole("button", { name: "Cancelar agendamento" }).click();
  await page.getByText(/Agendamento de Pedro Álvares Verificação cancelado/).waitFor({ timeout: 20_000 });
  await shot(page, "15-cancelado-desfazer");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await page.getByText("Agendamento restaurado.").waitFor({ timeout: 20_000 });
  await page.getByText("Pedro Álvares Verificação").first().waitFor();
  await shot(page, "16-restaurado");
});

await step("W5", "deep link: paciente pré-selecionado e CTA utilizável", async () => {
  await robustGoto(page, `${BASE}/agenda?new=1&patientId=${maria.id}`);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => ((document.querySelector('[role="dialog"] input') as HTMLInputElement)?.value ?? "").length > 0,
    undefined,
    { timeout: 20_000 },
  );
  const patientValue = await dialog.getByLabel("Paciente *").inputValue();
  if (patientValue !== "Maria Souza Lima") throw new Error(`paciente do deep link: "${patientValue}"`);
  await page.waitForTimeout(1_500);
  const confirmDisabled = await dialog.getByRole("button", { name: "Agendar", exact: true }).isDisabled();
  console.log(`  [W5] botão Agendar desabilitado sem interação: ${confirmDisabled}`);
  await shot(page, "19-deeplink-paciente");
  if (confirmDisabled) throw new Error("CTA 'Agendar' desabilitado sem explicação no deep link pré-preenchido");
});

await step("W6", "erro de rede vira erro com retry (nunca estado vazio)", async () => {
  try {
    await desktop.route("**/rest/v1/**", (route) => route.abort());
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const errorAlert = page.locator(".MuiAlert-root").filter({ hasText: /Não foi possível/ });
    await errorAlert.first().waitFor({ timeout: 30_000 });
    console.log(`  [W6] erro exibido: ${JSON.stringify((await errorAlert.first().textContent())?.slice(0, 120))}`);
    const emptyLeak =
      (await page.getByText("Nenhuma consulta neste dia").count()) +
      (await page.getByText("Nenhuma consulta agendada").count());
    if (emptyLeak > 0) throw new Error("estado vazio renderizado durante falha");
    await shot(page, "20-erro-com-retry");
  } finally {
    await desktop.unroute("**/rest/v1/**");
  }
  const retry = page.getByRole("button", { name: "Tentar novamente" });
  if (await retry.count()) {
    await retry.first().click();
    try {
      await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 15_000 });
      console.log("  [W6] retry recuperou sem reload");
    } catch {
      console.log("  [W6] retry não recuperou sem reload — recarregando para confirmar dados");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 60_000 });
    }
  } else {
    throw new Error("erro sem botão de retry");
  }
  await shot(page, "21-retry-recupera");
});

await step("W7", "teclado: diálogo recebe foco e Esc fecha", async () => {
  await page.getByRole("button", { name: "Agendar consulta" }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(500);
  const focusInDialog = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  if (!focusInDialog) throw new Error("foco não entrou no diálogo");
});

await step("W8", "dark: dia + diálogo legíveis", async () => {
  const state = await desktop.storageState();
  const dark = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    locale: "pt-BR",
    timezoneId: TZ,
    storageState: state,
  });
  const d = await dark.newPage();
  d.setDefaultTimeout(30_000);
  current = d;
  await robustGoto(d, `${BASE}/agenda`);
  await d.getByText("Maria Souza Lima").first().waitFor({ timeout: 90_000 });
  let isDark = await d.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log(`  [W8] dark via prefers-color-scheme: ${isDark} (light-first é decisão de design)`);
  if (!isDark) {
    const prefix = process.env.NEXT_PUBLIC_STORAGE_PREFIX || "";
    await d.evaluate((key) => localStorage.setItem(key, JSON.stringify("dark")), `${prefix}-theme-mode`);
    await d.reload({ waitUntil: "domcontentloaded" });
    await d.getByText("Maria Souza Lima").first().waitFor({ timeout: 60_000 });
    isDark = await d.evaluate(() => document.documentElement.classList.contains("dark"));
  }
  if (!isDark) throw new Error("modo dark não ativou nem via localStorage");
  await shot(d, "25-dark-dia");
  await d.getByRole("button", { name: "Agendar consulta" }).first().click();
  await d.getByRole("dialog").waitFor();
  await shot(d, "26-dark-dialogo");
  await dark.close();
  current = page;
});

await step("W9", "usuário novo: agenda vazia guia para valor", async () => {
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "pt-BR",
    timezoneId: TZ,
  });
  const n = await fresh.newPage();
  n.setDefaultTimeout(30_000);
  current = n;
  await login(n, NEW_EMAIL);
  await shot(n, "27-novo-pos-login");
  await robustGoto(n, `${BASE}/agenda`);
  await n.getByText("Nenhuma consulta neste dia").waitFor({ timeout: 90_000 });
  await n.getByText("Seu dia está livre").waitFor();
  await shot(n, "28-novo-agenda-vazia");
  await n.getByRole("button", { name: "Agendar consulta" }).last().click();
  const dialog = n.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cadastrar novo paciente aqui" }).waitFor();
  await shot(n, "29-novo-dialogo-sem-pacientes");
  await n.keyboard.press("Escape");
  await n.getByRole("dialog").waitFor({ state: "hidden" });
  await n.getByRole("button", { name: "Próximas" }).click();
  await n.getByText("Nenhuma consulta agendada").waitFor();
  await shot(n, "30-novo-proximas-vazia");
  await fresh.close();
  current = page;
});

await browser.close();
console.log("\n==== RESULTADO WALK 4 ====");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id} — ${r.name}${r.err ? ` :: ${r.err}` : ""}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passos OK.`);
