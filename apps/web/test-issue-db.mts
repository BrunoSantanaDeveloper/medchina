/**
 * Real issuance of a validated therapeutic plan through @flyee/documents +
 * the MedChina PDF renderer, against the real database and storage:
 *  - the document is stored, hashed, and verifiable via verify_document();
 *  - reissuing supersedes the previous version;
 *  - the private bucket is RLS-gated (another org cannot read the file).
 *
 * Run from apps/web:  npx tsx --conditions=react-server test-issue-db.mts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync("c:/AppsProjects/medchina/apps/web/.env", "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)="?(.*?)"?$/);
  if (m) process.env[m[1]] = m[2];
}

const { renderPlanPdf } = await import("@/lib/plan-document");
const { issueDocument, revokeDocument, sha256Hex } = await import("@flyee/documents");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); ok ? pass++ : fail++; };

const t = (key: string) => key; // labels are exercised by test-pdf; here we test issuance

const mk = async (tag: string, name: string) => {
  const email = `issue.${tag}.${Date.now()}@medchina-test.dev`;
  const { data } = await admin.auth.admin.createUser({ email, password: "Consulta#2026", email_confirm: true, user_metadata: { display_name: name, company: `Consultório ${name}` } });
  const { data: m } = await admin.from("memberships").select("org_id").eq("user_id", data!.user.id).maybeSingle();
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: "Consulta#2026" });
  const { data: patient } = await admin.from("patients").insert({ org_id: m!.org_id, full_name: "Ana", created_by: data!.user.id }).select().single();
  const { data: consultation } = await admin.from("consultations").insert({ org_id: m!.org_id, patient_id: patient!.id, created_by: data!.user.id }).select().single();
  return { userId: data!.user.id, orgId: m!.org_id, client, patientId: patient!.id, consultationId: consultation!.id };
};

const A = await mk("a", "Helena");
const B = await mk("b", "Marina");

const { data: plan } = await admin.from("consultation_plans").insert({
  org_id: A.orgId, consultation_id: A.consultationId, objective: "Nutrir o Yin",
  modalities: { acupuncture: { enabled: true, mainPoints: ["KI3", "HT7"], frequency: "1x/semana" } },
  safety_flags: [{ category: "pregnancy", matchedText: "Gestante" }],
  status: "validated", validated_by: A.userId, validated_at: new Date().toISOString(),
  model: "gemini-2.5-flash", prompt_version: "test", created_by: A.userId,
}).select("id").single();

const docData = {
  orgName: "Consultório Helena", patientName: "Ana", professionalName: "Helena",
  consultationDate: "14/07/2026", validatedAt: "14/07/2026", version: 1, issuedAt: "15/07/2026",
  objective: "Nutrir o Yin", modalities: [{ slug: "acupuncture", fields: [{ label: "Pontos", value: "", list: ["KI3", "HT7"] }] }],
  safetyFlags: [{ category: "pregnancy", matchedText: "Gestante" }],
};

// ---- 1. issue --------------------------------------------------------------
console.log("\n1. Emissão do documento (PDF real + storage)");
const r1 = await issueDocument(
  A.client as never,
  { orgId: A.orgId, kind: "therapeutic-plan", title: "Plano — Ana", payload: { planId: plan!.id, consultationId: A.consultationId, snapshot: docData }, issuedBy: A.userId, version: 1, verifyBaseUrl: "https://app.test" },
  (ctx) => renderPlanPdf(docData as never, t, ctx),
);
check("emitido com sucesso", r1.ok === true, r1.ok ? r1.verifyCode : r1.error);
if (!r1.ok) { console.log("abortando"); process.exit(1); }

const { data: doc } = await admin.from("documents").select("*").eq("id", r1.documentId).single();
check("status = issued", doc.status === "issued", doc.status);
check("content_hash gravado", /^[0-9a-f]{64}$/.test(doc.content_hash ?? ""));
check("storage_path gravado", Boolean(doc.storage_path));
check("verify_code de 12 chars", (doc.verify_code ?? "").length === 12);

// ---- 2. the stored file matches the hash -----------------------------------
console.log("\n2. Integridade do arquivo armazenado");
{
  const { data: file } = await admin.storage.from("documents").download(doc.storage_path);
  const bytes = new Uint8Array(await file!.arrayBuffer());
  check("arquivo é um PDF", Buffer.from(bytes.slice(0, 5)).toString("latin1") === "%PDF-");
  check("hash bate com o registrado", sha256Hex(bytes) === doc.content_hash);
}

// ---- 3. public verification -------------------------------------------------
console.log("\n3. Verificação pública (QR)");
{
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data } = await anon.rpc("verify_document", { code: doc.verify_code });
  const row = data?.[0];
  check("verify_document retorna o documento", Boolean(row), row ? row.title : "vazio");
  check("expõe o consultório emissor", row?.organization_name?.includes("Helena"), row?.organization_name);
  check("status issued visível", row?.status === "issued");
  check("NÃO expõe o payload/snapshot", !("payload" in (row ?? {})));
}

// ---- 4. reissue supersedes --------------------------------------------------
console.log("\n4. Reemissão substitui a versão anterior");
{
  const r2 = await issueDocument(
    A.client as never,
    { orgId: A.orgId, kind: "therapeutic-plan", title: "Plano — Ana", payload: { planId: plan!.id, consultationId: A.consultationId, snapshot: docData }, issuedBy: A.userId, parentId: r1.documentId, version: 2, verifyBaseUrl: "https://app.test" },
    (ctx) => renderPlanPdf({ ...docData, version: 2 } as never, t, ctx),
  );
  check("v2 emitida", r2.ok === true, r2.ok ? "" : r2.error);
  await revokeDocument(A.client as never, r1.documentId);
  const { data: v1 } = await admin.from("documents").select("status").eq("id", r1.documentId).single();
  check("v1 marcada como revogada (substituída)", v1.status === "revoked");
  const { data: v2 } = await admin.from("documents").select("version, parent_id").eq("id", (r2 as { documentId: string }).documentId).single();
  check("v2 aponta para v1 (parent_id)", v2.parent_id === r1.documentId);
  check("v2 é versão 2", v2.version === 2);
  // Revoked still verifiable — the trail is never broken.
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data } = await anon.rpc("verify_document", { code: doc.verify_code });
  check("v1 revogada ainda é verificável, sinalizada", data?.[0]?.status === "revoked", data?.[0]?.status);
}

// ---- 5. bucket isolation ----------------------------------------------------
console.log("\n5. Isolamento do bucket privado");
{
  const { data, error } = await B.client.storage.from("documents").download(doc.storage_path);
  check("B não baixa o documento de A", !data || Boolean(error), error?.message?.slice(0, 40) ?? "sem dados");
  const { data: rows } = await B.client.from("documents").select("id").eq("org_id", A.orgId);
  check("B não lê a linha do documento de A", (rows?.length ?? 0) === 0);
}

for (const who of [A, B]) await admin.auth.admin.deleteUser(who.userId);
const { data: orgs } = await admin.from("organizations").select("id");
const { data: members } = await admin.from("memberships").select("org_id");
const withMembers = new Set((members ?? []).map((m) => m.org_id));
for (const o of (orgs ?? []).filter((o) => !withMembers.has(o.id))) await admin.from("organizations").delete().eq("id", o.id);
console.log("\nlimpeza concluída");
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
