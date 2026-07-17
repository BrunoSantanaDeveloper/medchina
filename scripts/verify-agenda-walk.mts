/**
 * Temporary product-verify walk of the agenda flow (delete after verification).
 * Drives the REAL app at localhost:3010 with the seeded workspace and captures
 * evidence screenshots into the session scratchpad.
 *
 * Run from the repo root: node_modules/.bin/tsx scripts/verify-agenda-walk.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const PASSWORD = "Verify!Agenda2026#mc";
const NEW_EMAIL = "verify-agenda-new@medchina.dev";
const TZ = "America/Sao_Paulo";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// ---------- fresh brand-new user for the first-run pass ----------
{
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = data?.users.find((u) => u.email === NEW_EMAIL);
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
  } else {
    const { error } = await admin.auth.admin.createUser({
      email: NEW_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Dra. Nova", company: "Consultório Novo" },
    });
    if (error) throw new Error(`createUser new: ${error.message}`);
  }
}

// ---------- read the seeded facts (ids + times) ----------
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
  return `${v.day}${v.month}${v.year}${v.hour}${v.minute}`; // DDMMYYYYHHmm digit stream
};
const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

const mariaStart = new Date(mariaToday.scheduled_for as string);
const conflictAt = new Date(mariaStart.getTime() + 10 * 60_000);
const lastEnd = consultations!
  .filter((c) => c.status !== "cancelled")
  .reduce((max, c) => {
    const end = new Date(c.scheduled_for as string).getTime() + (c.duration_minutes as number) * 60_000;
    return Math.max(max, end);
  }, 0);
const todayFree = new Date(Math.max(lastEnd, Date.now()) + 45 * 60_000);

// ---------- walk harness ----------

type StepResult = { id: string; name: string; ok: boolean; err?: string };
const results: StepResult[] = [];
let failShotPage: Page | null = null;
async function step(id: string, name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ id, name, ok: true });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({ id, name, ok: false, err: String(error).slice(0, 400) });
    console.log(`FAIL ${id} ${name} :: ${String(error).slice(0, 200)}`);
    try {
      if (failShotPage && !failShotPage.isClosed()) {
        await failShotPage.screenshot({ path: resolve(SHOTS, `fail-${id}.png`), fullPage: true });
      }
    } catch {
      /* evidence only */
    }
  }
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true }).then(() => {});

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (!new URL(page.url()).pathname.startsWith("/auth")) return;
    const alert = page.locator(".MuiAlert-root");
    if (await alert.count()) {
      const text = (await alert.first().textContent())?.slice(0, 160);
      throw new Error(`login não navegou; alerta: ${JSON.stringify(text)}`);
    }
    if (Date.now() > deadline) throw new Error(`login não navegou em 90s (url: ${page.url()})`);
    await page.waitForTimeout(500);
  }
}

/** Type a DDMMYYYYHHmm digit stream into the MUI X datetime field inside `scope`. */
async function setDateTime(scope: Locator, digits: string) {
  const page = scope.page();
  const spin = scope.locator('[role="spinbutton"]');
  const spinCount = await spin.count();
  console.log(`  [picker] spinbuttons: ${spinCount}`);
  if (spinCount > 0) {
    await spin.first().click();
  } else {
    const input = scope.getByLabel(/Data e hora/).first();
    await input.click();
    await page.keyboard.press("Control+a");
  }
  await page.keyboard.type(digits, { delay: 40 });
}

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
  locale: "pt-BR",
  timezoneId: TZ,
});
const page = await desktop.newPage();
page.setDefaultTimeout(20_000);
failShotPage = page;

// ---------- J1: sign in and reach the agenda from the menu ----------
await step("J1", "login + chegar na agenda pelo menu", async () => {
  await login(page, EMAIL);
  await shot(page, "01-pos-login");
  const menuLink = page.locator('a[href="/agenda"]').first();
  if (await menuLink.count()) await menuLink.click();
  else await page.goto(`${BASE}/agenda`);
  await page.locator("h1", { hasText: "Agenda" }).waitFor({ timeout: 60_000 });
  await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 30_000 });
  await shot(page, "02-agenda-dia");
});

// ---------- J2: today's real statuses render with the right actions ----------
await step("J2", "dia mostra finalizada/agendada/em-atendimento com ações corretas", async () => {
  await page.getByText("Finalizada").first().waitFor();
  await page.getByRole("button", { name: /Abrir consulta de Ana Beatriz Castro/ }).waitFor(); // finalized -> Ver consulta
  await page.getByText("Em atendimento").first().waitFor();
  await page.getByRole("button", { name: /Reagendar consulta de Maria Souza Lima/ }).waitFor();
  await page.getByRole("button", { name: /Cancelar agendamento de Maria Souza Lima/ }).waitFor();
  const iniciar = page.getByRole("button", { name: /Abrir consulta de Maria Souza Lima/ });
  if ((await iniciar.textContent()) !== "Iniciar atendimento") throw new Error("CTA da agendada não é 'Iniciar atendimento'");
});

// ---------- J3: cancelled audit view ----------
await step("J3", "ver cancelados: motivo + restaurar", async () => {
  await page.getByRole("button", { name: "Ver cancelados" }).click();
  await page.getByText("Motivo: Paciente pediu para remarcar").waitFor();
  await page.getByRole("button", { name: /Restaurar agendamento de João Pereira/ }).waitFor();
  await shot(page, "03-cancelados");
  await page.getByRole("button", { name: "Ver agenda ativa" }).click();
  await page.getByText("Maria Souza Lima").first().waitFor();
});

// ---------- J4: upcoming view + filter + no-match ----------
await step("J4", "próximas: grupos Hoje/Amanhã + filtro + sem-resultado com volta", async () => {
  await page.getByRole("button", { name: "Próximas" }).click();
  await page.getByText(/^Hoje ·/).first().waitFor();
  await page.getByText(/^Amanhã ·/).first().waitFor();
  await shot(page, "04-proximas");
  const filter = page.getByLabel("Buscar por paciente");
  await filter.fill("Maria");
  await page.getByText("João Pereira").first().waitFor({ state: "hidden" });
  await page.getByText("Maria Souza Lima").first().waitFor();
  await shot(page, "05-proximas-filtro-maria");
  await filter.fill("Xavier Inexistente");
  await page.getByText("Nenhuma consulta encontrada").waitFor();
  await shot(page, "06-proximas-sem-resultado");
  await page.getByRole("button", { name: "Limpar busca" }).click();
  await page.getByText("Maria Souza Lima").first().waitFor();
  await page.getByRole("button", { name: "Dia", exact: true }).click();
  await page.getByText("Maria Souza Lima").first().waitFor();
});

// ---------- J5: schedule with inline patient detour (context preserved) + conflict ----------
await step("J5", "agendar: desvio criar-paciente preserva contexto", async () => {
  // Investigate duplicate "Agendar consulta" buttons before clicking.
  const dupes = await page
    .getByRole("button", { name: "Agendar consulta" })
    .evaluateAll((els) =>
      els.map((el) => ({
        visible: (el as HTMLElement).offsetParent !== null,
        html: (el as HTMLElement).outerHTML.slice(0, 160),
      })),
    );
  console.log(`  [J5] botões 'Agendar consulta': ${JSON.stringify(dupes)}`);
  await page.getByRole("button", { name: "Agendar consulta" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Observação do agendamento/).fill("Verificação de contexto");
  await dialog.getByRole("combobox", { name: "Duração" }).click();
  await page.getByRole("option", { name: "90 min" }).click();
  await shot(page, "07-dialogo-preenchido");
  await dialog.getByRole("button", { name: "Cadastrar novo paciente aqui" }).click();
  await dialog.getByText("Novo paciente").waitFor();
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
});

await step("J6", "conflito de horário avisa e permite ajustar", async () => {
  const dialog = page.getByRole("dialog");
  await setDateTime(dialog, fmtDigits(conflictAt));
  await dialog.getByRole("button", { name: "Agendar", exact: true }).click();
  await dialog.getByText(/nesse horário/).waitFor();
  await dialog.getByRole("button", { name: "Agendar mesmo assim" }).waitFor();
  await shot(page, "10-conflito");
  await setDateTime(dialog, fmtDigits(todayFree));
  await dialog.getByRole("button", { name: "Agendar", exact: true }).click();
  await page.getByText("Consulta agendada.").waitFor();
  await shot(page, "11-agendada-snackbar");
});

// ---------- J7: reschedule the fresh appointment ----------
await step("J7", "reagendar preenche contexto e confirma", async () => {
  // The fresh appointment may have landed today or later; upcoming always shows it.
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
  await page.getByText("Agendamento atualizado.").waitFor();
  await shot(page, "13-reagendado");
});

// ---------- J8: cancel names the consequence, offers undo, undo works ----------
await step("J8", "cancelar confirma consequência + desfazer restaura", async () => {
  await page.getByRole("button", { name: /Cancelar agendamento de Pedro Álvares Verificação/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Cancelar este agendamento?").waitFor();
  await dialog.getByText(/O horário de Pedro Álvares Verificação/).waitFor();
  await dialog.getByLabel(/Motivo/).fill("Teste de desfazer");
  await shot(page, "14-cancelar-confirmacao");
  await dialog.getByRole("button", { name: "Cancelar agendamento" }).click();
  await page.getByText(/Agendamento de Pedro Álvares Verificação cancelado/).waitFor();
  await shot(page, "15-cancelado-desfazer");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await page.getByText("Agendamento restaurado.").waitFor();
  await page.getByText("Pedro Álvares Verificação").first().waitFor();
  await shot(page, "16-restaurado");
});

// ---------- J9: start -> lands in the consultation, agenda reflects it ----------
await step("J9", "iniciar atendimento leva à consulta e agenda reflete", async () => {
  await page.getByRole("button", { name: "Dia", exact: true }).click();
  await page.getByRole("button", { name: /Abrir consulta de Maria Souza Lima/ }).click();
  await page.waitForURL(/\/consultas\//, { timeout: 60_000 });
  await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 60_000 });
  await shot(page, "17-consulta-aberta");
  await page.goBack();
  await page.getByRole("heading", { name: "Agenda", exact: true }).waitFor();
  const cta = page.getByRole("button", { name: /Abrir consulta de Maria Souza Lima/ });
  await cta.waitFor();
  if ((await cta.textContent()) !== "Abrir consulta") throw new Error("CTA não virou 'Abrir consulta'");
  await page.getByText("Em atendimento").nth(1).waitFor();
  await shot(page, "18-agenda-apos-iniciar");
});

// ---------- J10: deep link ?new=1&patientId lands in context ----------
await step("J10", "deep link novo agendamento com paciente pré-selecionado", async () => {
  await page.goto(`${BASE}/agenda?new=1&patientId=${maria.id}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Agendar consulta").waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => (document.querySelector('[role="dialog"] input') as HTMLInputElement)?.value?.length > 0,
    undefined,
    { timeout: 15_000 },
  );
  const patientValue = await dialog.getByLabel("Paciente *").inputValue();
  if (patientValue !== "Maria Souza Lima") throw new Error(`paciente do deep link: "${patientValue}"`);
  // Can the user confirm WITHOUT touching any field? A disabled CTA with no
  // explanation on a fully prefilled dialog would be a dead end.
  await page.waitForTimeout(1_500);
  const confirmDisabled = await dialog.getByRole("button", { name: "Agendar", exact: true }).isDisabled();
  console.log(`  [J10] botão Agendar desabilitado sem interação: ${confirmDisabled}`);
  await shot(page, "19-deeplink-paciente");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
});

// ---------- P1: error != empty ----------
await step("P1", "erro de rede vira erro com retry (nunca estado vazio)", async () => {
  try {
    await desktop.route("**/rest/v1/**", (route) => route.abort());
    await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
    // Either the load error or the workspace error is an honest failure surface.
    const errorAlert = page.locator('[role="alert"], .MuiAlert-root').filter({ hasText: /Não foi possível/ });
    await errorAlert.first().waitFor({ timeout: 30_000 });
    console.log(`  [P1] erro exibido: ${JSON.stringify((await errorAlert.first().textContent())?.slice(0, 120))}`);
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
      console.log("  [P1] retry recuperou sem reload");
    } catch {
      console.log("  [P1] retry NÃO recuperou sem reload — verificando com reload");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 30_000 });
    }
  } else {
    console.log("  [P1] sem botão de retry no erro exibido");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Maria Souza Lima").first().waitFor({ timeout: 30_000 });
  }
  await shot(page, "21-retry-recupera");
});

// ---------- P2: a11y probes ----------
await step("P2", "sem botões-ícone sem nome + sem leftovers + locale pt-BR", async () => {
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => !b.textContent!.trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby"))
      .map((b) => b.outerHTML.slice(0, 200)),
  );
  if (unnamed.length > 0) throw new Error(`${unnamed.length} botões sem nome acessível: ${unnamed.join(" ||| ")}`);
  const leftovers = await page.evaluate(() =>
    ["Add Product", "Add Category", "Discounts", "ThemeForest"].filter((t) => document.body.innerText.includes(t)),
  );
  if (leftovers.length) throw new Error(`leftovers: ${leftovers.join(", ")}`);
  const text = await page.evaluate(() => document.body.innerText);
  const enLeaks = ["Schedule", "Upcoming", "Loading", "Retry", "Today", "Cancelled"].filter((w) =>
    new RegExp(`\\b${w}\\b`).test(text),
  );
  if (enLeaks.length) throw new Error(`vazamento EN: ${enLeaks.join(", ")}`);
});

await step("P3", "teclado: diálogo recebe foco e Esc fecha", async () => {
  await page.getByRole("button", { name: "Agendar consulta" }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(400);
  const focusInDialog = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  if (!focusInDialog) throw new Error("foco não entrou no diálogo");
});

// ---------- mobile 390x844 ----------
await step("M1", "mobile 390: jornada completável, sem scroll horizontal", async () => {
  const state = await desktop.storageState();
  writeFileSync(resolve(SHOTS, "state.json"), JSON.stringify(state));
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    locale: "pt-BR",
    timezoneId: TZ,
    storageState: state,
  });
  const m = await mobile.newPage();
  m.setDefaultTimeout(20_000);
  await m.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
  await m.getByText("Maria Souza Lima").first().waitFor({ timeout: 60_000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(m, "22-mobile-dia");
  await m.getByRole("button", { name: "Agendar consulta" }).click();
  await m.getByRole("dialog").waitFor();
  await shot(m, "23-mobile-dialogo");
  await m.keyboard.press("Escape");
  await m.getByRole("button", { name: "Próximas" }).click();
  await m.getByText(/^Hoje ·/).first().waitFor();
  await shot(m, "24-mobile-proximas");
  await mobile.close();
  if (overflow > 2) throw new Error(`scroll horizontal de ${overflow}px`);
});

// ---------- dark ----------
await step("D1", "dark: dia + diálogo legíveis", async () => {
  const state = JSON.parse(readFileSync(resolve(SHOTS, "state.json"), "utf8"));
  const dark = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    locale: "pt-BR",
    timezoneId: TZ,
    storageState: state,
  });
  const d = await dark.newPage();
  d.setDefaultTimeout(20_000);
  await d.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
  await d.getByText("Maria Souza Lima").first().waitFor({ timeout: 60_000 });
  let isDark = await d.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log(`  [D1] dark via prefers-color-scheme: ${isDark} (light-first é decisão de design)`);
  if (!isDark) {
    const prefix = process.env.NEXT_PUBLIC_STORAGE_PREFIX || "";
    await d.evaluate((key) => localStorage.setItem(key, JSON.stringify("dark")), `${prefix}-theme-mode`);
    await d.reload({ waitUntil: "domcontentloaded" });
    await d.getByText("Maria Souza Lima").first().waitFor({ timeout: 30_000 });
    isDark = await d.evaluate(() => document.documentElement.classList.contains("dark"));
  }
  if (!isDark) throw new Error("modo dark não ativou nem via localStorage");
  await shot(d, "25-dark-dia");
  await d.getByRole("button", { name: "Agendar consulta" }).click();
  await d.getByRole("dialog").waitFor();
  await shot(d, "26-dark-dialogo");
  await dark.close();
});

// ---------- first-run (brand-new workspace) ----------
await step("N1", "usuário novo: agenda vazia guia para valor (sem beco sem saída)", async () => {
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "pt-BR",
    timezoneId: TZ,
  });
  const n = await fresh.newPage();
  n.setDefaultTimeout(25_000);
  failShotPage = n;
  await login(n, NEW_EMAIL);
  await shot(n, "27-novo-pos-login");
  await n.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
  await n.getByText("Nenhuma consulta neste dia").waitFor({ timeout: 60_000 });
  await n.getByText("Seu dia está livre").waitFor();
  await shot(n, "28-novo-agenda-vazia");
  await n.getByRole("button", { name: "Agendar consulta" }).last().click();
  const dialog = n.getByRole("dialog");
  await dialog.getByText("Agendar consulta").waitFor();
  await dialog.getByRole("button", { name: "Cadastrar novo paciente aqui" }).waitFor();
  await shot(n, "29-novo-dialogo-sem-pacientes");
  await n.keyboard.press("Escape");
  await n.getByRole("button", { name: "Próximas" }).click();
  await n.getByText("Nenhuma consulta agendada").waitFor();
  await shot(n, "30-novo-proximas-vazia");
  await fresh.close();
});

await browser.close();

console.log("\n==== RESULTADO ====");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id} — ${r.name}${r.err ? ` :: ${r.err}` : ""}`);
writeFileSync(resolve(SHOTS, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passos OK. Screenshots em ${SHOTS}`);
