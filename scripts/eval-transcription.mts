/**
 * Compare transcription models on REAL consultation audio.
 *
 *   node_modules/.bin/tsx scripts/eval-transcription.mts
 *   node_modules/.bin/tsx scripts/eval-transcription.mts --models gemini-2.5-flash-lite,gemini-3.1-flash-lite
 *   node_modules/.bin/tsx scripts/eval-transcription.mts --limit 2
 *
 * WHY: the transcription model is ~90% of the AI bill, and every proposal to
 * change it has so far been a guess. The blocker was never price — it is
 * whether a cheaper model still separates the speakers, because the whole
 * clinical safety rule ("tongue, pulse and palpation only from the
 * practitioner's own voice") reads the diarization. A model that transcribes
 * beautifully and collapses both voices into one speaker is useless here, and
 * no price table says that.
 *
 * It runs the PRODUCTION path (`transcribeAudio` from @flyee/transcribe), so
 * the coverage check, the continuation loop and the timestamp/speaker
 * normalisation are the same ones that run for a real consultation. Fallbacks
 * are disabled: a failure must be visible as a failure, not silently rescued
 * by another model.
 *
 * PRIVACY: this reads real patient audio and never prints a word of it. Only
 * aggregate metrics leave this script. Do not add transcript output to it.
 *
 * READ-ONLY against production: nothing is written back to `transcriptions`.
 * The stored transcript is the REFERENCE, not ground truth — it was produced by
 * the model in use today, so "agreement" means agreement with the incumbent,
 * and a disagreement is a question to listen to, not automatically an error.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { transcribeAudio, transcriptCoverage, type TranscriptResult } from "../packages/transcribe/src/index.ts";

const ROOT = resolve(import.meta.dirname, "..");

function loadEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env) && value) process.env[match[1]] = value;
  }
}
loadEnv(resolve(ROOT, "apps/web/.env"));

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const MODELS = (option("models") ?? "gemini-2.5-flash-lite,gemini-3.1-flash-lite").split(",").map((m) => m.trim());
const LIMIT = Number(option("limit") ?? 3);
/** Shortest audio worth comparing — a 1-second clip measures nothing. */
const MIN_SECONDS = Number(option("min-seconds") ?? 60);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !process.env.GEMINI_API_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou GEMINI_API_KEY.");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Terms whose loss would matter clinically — checked only when the reference has them. */
const MTC_TERMS = [
  "língua", "pulso", "saburra", "palpação", "meridiano", "qi", "yang", "yin", "moxa", "moxabustão",
  "ventosa", "agulha", "acupuntura", "baço", "rim", "fígado", "coração", "pulmão", "estômago",
  "estagnação", "umidade", "deficiência", "calor", "frio", "cun", "shen", "jing", "xue",
];
const POINT_CODE = /\b(?:IG|E|BP|C|ID|B|R|PC|TA|VB|F|P|VC|VG)\d{1,2}\b/gi;

const normalize = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const wordsOf = (result: TranscriptResult) => normalize(result.segments.map((s) => s.text).join(" ")).split(" ").filter((w) => w.length > 2);

/** How often the speaker changes between consecutive segments — diarization alive or collapsed. */
function turnRate(result: TranscriptResult) {
  if (result.segments.length < 2) return 0;
  let changes = 0;
  for (let i = 1; i < result.segments.length; i++) {
    if (result.segments[i].speaker !== result.segments[i - 1].speaker) changes += 1;
  }
  return changes / (result.segments.length - 1);
}

function termsIn(result: TranscriptResult) {
  const text = normalize(result.segments.map((s) => s.text).join(" "));
  const found = new Set(MTC_TERMS.filter((t) => text.includes(normalize(t))));
  for (const code of result.segments.map((s) => s.text).join(" ").match(POINT_CODE) ?? []) found.add(code.toUpperCase());
  return found;
}

/** Share of the reference's content words the candidate also produced. */
function recall(reference: string[], candidate: string[]) {
  const pool = new Map<string, number>();
  for (const w of candidate) pool.set(w, (pool.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of reference) {
    const left = pool.get(w) ?? 0;
    if (left > 0) { pool.set(w, left - 1); hit += 1; }
  }
  return reference.length ? hit / reference.length : 0;
}

interface Candidate {
  id: string;
  audioPath: string;
  mime: string;
  seconds: number | null;
  reference: TranscriptResult;
}

async function loadCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("transcriptions")
    .select("id, audio_path, mime, result, recordings(duration_seconds)")
    .eq("status", "ready")
    .not("audio_path", "is", null);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const rec = row.recordings as unknown as { duration_seconds: number | null }[] | { duration_seconds: number | null } | null;
      const seconds = Array.isArray(rec) ? (rec[0]?.duration_seconds ?? null) : (rec?.duration_seconds ?? null);
      return {
        id: row.id as string,
        audioPath: row.audio_path as string,
        mime: (row.mime as string) ?? "audio/webm",
        seconds,
        reference: row.result as TranscriptResult,
      };
    })
    .filter((c) => (c.seconds ?? 0) >= MIN_SECONDS && (c.reference?.segments?.length ?? 0) > 1)
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0))
    .slice(0, LIMIT);
}

const AUDIO_TOK_PER_SEC = 32;
const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash-lite": { in: 0.30, out: 0.40 },
  "gemini-3.1-flash-lite": { in: 0.50, out: 1.50 },
  "gemini-flash-latest": { in: 0.75, out: 3.75 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
};

async function main() {
  const candidates = await loadCandidates();
  if (candidates.length === 0) {
    console.error(`Nenhuma gravação com áudio preservado e ≥ ${MIN_SECONDS}s.`);
    process.exit(1);
  }

  console.log(`${candidates.length} gravação(ões) · modelos: ${MODELS.join(", ")}`);
  console.log(`referência: o transcript já armazenado (modelo em uso hoje)\n`);

  // The eval must see a model fail, not be rescued by another one.
  process.env.TRANSCRIBE_MODEL_FALLBACKS = "";

  for (const candidate of candidates) {
    const { data: blob, error } = await supabase.storage.from("transcriptions").download(candidate.audioPath);
    if (error || !blob) {
      console.log(`${candidate.id.slice(0, 8)} — áudio indisponível (${error?.message ?? "sem corpo"})\n`);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const refWords = wordsOf(candidate.reference);
    const refTerms = termsIn(candidate.reference);
    const refSpeakers = new Set(candidate.reference.segments.map((s) => s.speaker));

    console.log(`── ${candidate.id.slice(0, 8)} · ${candidate.seconds}s · ${(bytes.byteLength / 1048576).toFixed(1)} MB`);
    console.log(
      `   REFERÊNCIA        ${String(candidate.reference.segments.length).padStart(4)} seg · ` +
        `${refSpeakers.size} falantes · troca ${(turnRate(candidate.reference) * 100).toFixed(0)}% · ` +
        `cobertura ${(transcriptCoverage(candidate.reference, candidate.seconds) * 100).toFixed(0)}% · ` +
        `${refWords.length} palavras · ${refTerms.size} termos MTC`,
    );

    for (const model of MODELS) {
      process.env.TRANSCRIBE_MODEL = model;
      const started = Date.now();
      try {
        const result = await transcribeAudio(candidate.mime, bytes, candidate.seconds);
        const elapsed = (Date.now() - started) / 1000;
        const words = wordsOf(result);
        const speakers = new Set(result.segments.map((s) => s.speaker));
        const terms = termsIn(result);
        const kept = [...refTerms].filter((t) => terms.has(t)).length;
        const price = PRICES[model];
        const cost = price
          ? ((candidate.seconds ?? 0) * AUDIO_TOK_PER_SEC * price.in + words.length * 1.5 * price.out) / 1e6
          : null;

        console.log(
          `   ${model.padEnd(22).slice(0, 22)}${String(result.segments.length).padStart(4)} seg · ` +
            `${speakers.size} falantes · troca ${(turnRate(result) * 100).toFixed(0)}% · ` +
            `cobertura ${(transcriptCoverage(result, candidate.seconds) * 100).toFixed(0)}% · ` +
            `recall ${(recall(refWords, words) * 100).toFixed(0)}% · ` +
            `termos ${kept}/${refTerms.size} · ${elapsed.toFixed(0)}s` +
            (cost !== null ? ` · US$ ${cost.toFixed(4)}` : ""),
        );
        if (speakers.size < refSpeakers.size) {
          console.log(`   ${" ".repeat(22)}⚠ perdeu falantes — a regra de língua/pulso depende disso`);
        }
        if (transcriptCoverage(result, candidate.seconds) < 0.85) {
          console.log(`   ${" ".repeat(22)}⚠ abaixo do piso de cobertura de produção (0,85)`);
        }
      } catch (error) {
        console.log(`   ${model.padEnd(22).slice(0, 22)}FALHOU após ${((Date.now() - started) / 1000).toFixed(0)}s — ${error instanceof Error ? error.message.slice(0, 90) : error}`);
      }
    }
    console.log("");
  }

  console.log("Como ler: 'falantes' e 'troca' dizem se a diarização sobreviveu — é o que decide.");
  console.log("'recall' é concordância com o modelo atual, não acerto absoluto: divergência é pergunta, não erro.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
