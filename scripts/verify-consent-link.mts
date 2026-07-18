/**
 * Temporary product-verify walk of the QR consent link (delete after
 * verification). Proves the fix: a copied /consentir link keeps working after
 * the professional CLOSES the dialog, reopening shows the SAME link (no
 * silent supersede), and completion is detected by the reopened dialog.
 *
 * Run from the repo root: node_modules/.bin/tsx scripts/verify-consent-link.mts
 * Requires the web dev server on http://localhost:3010.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const BASE = "http://localhost:3010";
const SHOTS = resolve(
  "C:/Users/tribo/AppData/Local/Temp/claude/c--AppsProjects-medchina/a2bb062b-37e6-49f3-9f87-345c7b971f17/scratchpad",
  "consent-link-walk",
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
const PATIENT_NAME = "Paciente QR Consentimento";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// ---------- seed: verify user + a dedicated patient ----------
let userId: string | undefined;
{
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  userId = data.users.find((u) => u.email === EMAIL)?.id;
}
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Dra. Verificação", company: "Consultório Verificação" },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  userId = data.user!.id;
  await new Promise((r) => setTimeout(r, 1500)); // org-creation trigger
} else {
  await admin.auth.admin.updateUserById(userId, { password: PASSWORD });
}

const { data: membership } = await admin.from("memberships").select("org_id").eq("user_id", userId).limit(1);
if (!membership?.length) throw new Error("verify user has no organization membership");
const orgId = membership[0].org_id as string;

let patientId: string;
{
  const { data } = await admin.from("patients").select("id").eq("org_id", orgId).eq("full_name", PATIENT_NAME).limit(1);
  if (data?.length) {
    patientId = data[0].id as string;
  } else {
    const { data: inserted, error } = await admin
      .from("patients")
      .insert({ org_id: orgId, full_name: PATIENT_NAME, created_by: userId })
      .select("id")
      .single();
    if (error) throw new Error(`insert patient: ${error.message}`);
    patientId = inserted.id as string;
  }
}
console.log(`Seed OK — org ${orgId}, patient ${patientId}`);

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
    console.log(`FAIL ${id} ${name} :: ${String(error).slice(0, 300)}`);
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

const browser = await chromium.launch();
const pro = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const proPage = await pro.newPage();
proPage.setDefaultTimeout(20_000);
failShotPage = proPage;

// The "patient's phone": a separate, unauthenticated context.
const patientCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "light",
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const patientPage = await patientCtx.newPage();
patientPage.setDefaultTimeout(20_000);

const dialog = () => proPage.getByRole("dialog", { name: "Consentimento no celular" });
const readConsentUrl = async () => {
  const box = dialog().locator("p", { hasText: "/consentir#t=" }).first();
  await box.waitFor({ timeout: 30_000 });
  const text = (await box.textContent()) ?? "";
  const match = text.match(/https?:\/\/\S+\/consentir#t=[A-Za-z0-9_-]{43}/);
  if (!match) throw new Error(`link não encontrado no dialog: ${JSON.stringify(text.slice(0, 200))}`);
  return match[0];
};

let firstUrl = "";

await step("J1", "login + abrir consentimentos do paciente", async () => {
  await proPage.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle", timeout: 120_000 });
  const email = proPage.locator('input[name="email"], input[type="email"]').first();
  const password = proPage.locator('input[name="password"], input[type="password"]').first();
  // Formik discards values typed before hydration — fill until they stick.
  for (let attempt = 0; attempt < 5; attempt++) {
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    await proPage.waitForTimeout(400);
    if ((await email.inputValue()) === EMAIL && (await password.inputValue()) === PASSWORD) break;
  }
  await proPage.locator('button[type="submit"]').first().click();
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (!new URL(proPage.url()).pathname.startsWith("/auth")) break;
    if (Date.now() > deadline) throw new Error(`login não navegou em 90s (url: ${proPage.url()})`);
    await proPage.waitForTimeout(500);
  }
  await proPage.goto(`${BASE}/pacientes/${patientId}/consentimentos`, { waitUntil: "domcontentloaded" });
  await proPage.getByRole("button", { name: "Paciente confirma pelo celular" }).waitFor({ timeout: 60_000 });
  await shot(proPage, "01-consentimentos");
});

await step("J2", "gerar QR: link + aviso de validade + botão Fechar", async () => {
  await proPage.getByRole("button", { name: "Paciente confirma pelo celular" }).click();
  firstUrl = await readConsentUrl();
  await dialog().getByText("Você pode fechar esta janela: o link continua válido").waitFor();
  await dialog().getByRole("button", { name: "Fechar" }).waitFor();
  await shot(proPage, "02-dialog-qr");
});

await step("J3", "fechar o dialog NÃO cancela: link abre no celular do paciente", async () => {
  await dialog().getByRole("button", { name: "Fechar" }).click();
  await dialog().waitFor({ state: "hidden" });
  await proPage.waitForTimeout(1500); // window in which the old code fired the DELETE
  await patientPage.goto(firstUrl, { waitUntil: "domcontentloaded" });
  await patientPage.getByRole("heading", { name: "Suas escolhas de consentimento" }).waitFor({ timeout: 30_000 });
  const unavailable = await patientPage.getByText("Link indisponível").count();
  if (unavailable > 0) throw new Error("página pública mostrou 'Link indisponível'");
  await shot(patientPage, "03-paciente-form");
});

await step("J4", "reabrir o dialog mostra o MESMO link (sem supersede)", async () => {
  await proPage.getByRole("button", { name: "Paciente confirma pelo celular" }).click();
  const secondUrl = await readConsentUrl();
  if (secondUrl !== firstUrl) throw new Error(`link mudou ao reabrir: ${secondUrl} != ${firstUrl}`);
  await shot(proPage, "04-dialog-reaberto");
});

await step("J5", "paciente registra escolhas; dialog reaberto detecta conclusão", async () => {
  await patientPage.getByRole("button", { name: "Autorizar as três finalidades" }).click();
  await patientPage.getByLabel("Nome completo").fill("Paciente QR Consentimento");
  await patientPage.getByText("Confirmo que li os três termos acima").click();
  await patientPage.getByRole("button", { name: "Registrar minhas escolhas" }).click();
  await patientPage.getByRole("heading", { name: "Escolhas registradas" }).waitFor({ timeout: 30_000 });
  await shot(patientPage, "05-paciente-sucesso");
  // The dialog's polling pauses while the tab is hidden; in real use the
  // professional's tab is visible, so surface it before asserting.
  await proPage.bringToFront();
  await dialog().getByText("As escolhas foram registradas").waitFor({ timeout: 20_000 });
  await shot(proPage, "06-dialog-concluido");
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
for (const f of failed) console.log(`  FAIL ${f.id}: ${f.err}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
