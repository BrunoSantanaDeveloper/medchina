/**
 * Retrieval evaluation for the MTC clinical library.
 *
 *   node_modules/.bin/tsx scripts/eval-retrieval.mts                 # hybrid, the shipped behaviour
 *   node_modules/.bin/tsx scripts/eval-retrieval.mts --compare      # hybrid vs dense-only, side by side
 *   node_modules/.bin/tsx scripts/eval-retrieval.mts --lexical-only # no embedding calls at all
 *   node_modules/.bin/tsx scripts/eval-retrieval.mts --k 5
 *   node_modules/.bin/tsx scripts/eval-retrieval.mts --tier identifier
 *
 * Why this exists: every retrieval knob in the product — embedding model and
 * output dimensions, chunk size, the similarity floor, the trust bonus, the RRF
 * constant — was tunable with no way of telling whether a change helped. A
 * retrieval regression throws nothing and logs nothing; the hypotheses just come
 * back with fewer sources and nobody notices. This turns that into a number.
 *
 * It reads PRODUCTION data by default (the corpus lives there) but only ever
 * SELECTs: the search RPC is `stable`, and no other statement is issued. It does
 * spend embedding calls — one per query per mode, so ~50 with --compare.
 *
 * `--compare` answers the specific question "what did the hybrid search buy?"
 * by running the same cases with the lexical half switched off (query_text
 * null), which is exactly the pre-0062 behaviour.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GoogleGenAI } from "@google/genai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or GEMINI_API_KEY.");
  process.exit(1);
}

// Kept in step with packages/knowledge/src/embeddings.ts. Deliberately NOT
// imported from there: if the eval silently followed a change to the model, it
// would stop being able to detect that the change hurt.
const EMBEDDING_MODEL = process.env.EVAL_EMBEDDING_MODEL ?? "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = Number(process.env.EVAL_EMBEDDING_DIMENSIONS ?? 768);

type Tier = "identifier" | "clinical";
interface GoldenCase {
  id: string;
  tier: Tier;
  verified: boolean;
  query: string;
  expect: string[];
  note?: string;
}
interface GoldenSet {
  version: number;
  matchCount: number;
  cases: GoldenCase[];
}

const golden = JSON.parse(
  readFileSync(resolve(ROOT, "packages/knowledge/eval/golden-set.json"), "utf8"),
) as GoldenSet;

const K = Number(option("k") ?? golden.matchCount ?? 8);
const tierFilter = option("tier") as Tier | undefined;
const cases = golden.cases.filter((entry) => !tierFilter || entry.tier === tierFilter);

const gemini = new GoogleGenAI({ apiKey: GEMINI_KEY });
const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function embed(text: string): Promise<number[]> {
  const response = await gemini.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [text],
    config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: EMBEDDING_DIMENSIONS },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values) throw new Error(`Embedding failed for: ${text}`);
  return values;
}

/** doc id → metadata.key, so expectations survive a change of environment. */
async function loadKeyIndex(collectionIds: string[]) {
  const byId = new Map<string, string>();
  const known = new Set<string>();
  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("id, metadata")
    .in("collection_id", collectionIds);
  if (error) throw new Error(`Could not read documents: ${error.message}`);
  for (const row of data ?? []) {
    const key = (row.metadata as { key?: string } | null)?.key;
    if (!key) continue;
    byId.set(row.id as string, key);
    known.add(key);
  }
  return { byId, known };
}

interface CaseResult {
  entry: GoldenCase;
  hitRank: number | null;
  retrievedKeys: string[];
}

type Mode = "hybrid" | "dense" | "lexical";

/**
 * A valid unit vector plus an unreachable similarity floor, so the dense half
 * contributes nothing and the lexical ranking can be measured alone — with no
 * embedding API call at all.
 *
 * It must NOT be the zero vector, which is the obvious choice and is wrong:
 * cosine distance against a zero-norm vector is NaN, and PostgreSQL orders NaN
 * as GREATER than every number, so `NaN >= min_similarity` is TRUE. A zero
 * vector does not disable the dense half — it lets all of it through, ranked
 * arbitrarily, and quietly turns this mode into nonsense.
 */
const DEAD_VECTOR = JSON.stringify([1, ...new Array(EMBEDDING_DIMENSIONS - 1).fill(0)]);
/** Cosine similarity is bounded by 1, so nothing can clear this. */
const UNREACHABLE_SIMILARITY = 2;

async function runCase(entry: GoldenCase, collectionIds: string[], keyById: Map<string, string>, mode: Mode) {
  const embedding = mode === "lexical" ? DEAD_VECTOR : JSON.stringify(await embed(entry.query));
  const { data, error } = await supabase.rpc("knowledge_search", {
    query_embedding: embedding,
    collections: collectionIds,
    match_count: K,
    max_trust: 5,
    min_similarity: mode === "lexical" ? UNREACHABLE_SIMILARITY : 0.25,
    // The whole point of the comparison: null disables the lexical half, which
    // is the behaviour every caller had before migration 0062.
    query_text: mode === "dense" ? null : entry.query,
  });
  if (error) throw new Error(`Search failed for "${entry.query}": ${error.message}`);

  // Several chunks may belong to the same document; rank by first appearance.
  const retrievedKeys: string[] = [];
  for (const row of (data ?? []) as { document_id: string }[]) {
    const key = keyById.get(row.document_id);
    if (key && !retrievedKeys.includes(key)) retrievedKeys.push(key);
  }
  const hitIndex = retrievedKeys.findIndex((key) => entry.expect.includes(key));
  return { entry, hitRank: hitIndex >= 0 ? hitIndex + 1 : null, retrievedKeys } satisfies CaseResult;
}

function summarize(results: CaseResult[]) {
  if (results.length === 0) return { n: 0, recall: 0, mrr: 0 };
  const hits = results.filter((result) => result.hitRank !== null);
  const mrr = results.reduce((sum, result) => sum + (result.hitRank ? 1 / result.hitRank : 0), 0) / results.length;
  return { n: results.length, recall: hits.length / results.length, mrr };
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function report(label: string, results: CaseResult[]) {
  const byTier = (tier: Tier) => summarize(results.filter((result) => result.entry.tier === tier));
  const all = summarize(results);
  const identifier = byTier("identifier");
  const clinical = byTier("clinical");
  console.log(`\n${label}`);
  console.log(`  overall     n=${all.n}  recall@${K}=${pct(all.recall)}  MRR=${all.mrr.toFixed(3)}`);
  console.log(
    `  identifier  n=${identifier.n}  recall@${K}=${pct(identifier.recall)}  MRR=${identifier.mrr.toFixed(3)}   (objective)`,
  );
  console.log(
    `  clinical    n=${clinical.n}  recall@${K}=${pct(clinical.recall)}  MRR=${clinical.mrr.toFixed(3)}   (pending professional review)`,
  );
  const misses = results.filter((result) => result.hitRank === null);
  if (misses.length > 0) {
    console.log(`  misses:`);
    for (const miss of misses) {
      console.log(
        `    [${miss.entry.tier}] ${miss.entry.id} — "${miss.entry.query}"\n` +
          `        expected one of: ${miss.entry.expect.join(", ")}\n` +
          `        got: ${miss.retrievedKeys.slice(0, 5).join(", ") || "(nothing)"}`,
      );
    }
  }
  return all;
}

async function main() {
  const { data: collections, error: collectionsError } = await supabase
    .from("knowledge_collections")
    .select("id, slug")
    .in("slug", ["mtc-fontes-tradicionais", "mtc-protocolos-internos", "mtc-evidencia-cientifica"]);
  if (collectionsError) throw new Error(collectionsError.message);
  const collectionIds = (collections ?? []).map((row) => row.id as string);
  if (collectionIds.length === 0) throw new Error("No library collections found.");

  const { byId, known } = await loadKeyIndex(collectionIds);

  // A golden set whose expectations do not exist is worse than none: it fails
  // for a reason that has nothing to do with retrieval quality. Refuse early.
  const unresolvable = cases.flatMap((entry) =>
    entry.expect.filter((key) => !known.has(key)).map((key) => `${entry.id} → ${key}`),
  );
  if (unresolvable.length > 0) {
    console.error("Golden set references documents that do not exist in this corpus:");
    for (const line of unresolvable) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log(
    `Corpus: ${byId.size} documents · golden set v${golden.version} · ${cases.length} cases · k=${K}` +
      (flag("lexical-only") ? " · lexical half only (no embedding calls)" : ` · ${EMBEDDING_MODEL}@${EMBEDDING_DIMENSIONS}d`),
  );

  if (flag("lexical-only")) {
    const lexical: CaseResult[] = [];
    for (const entry of cases) lexical.push(await runCase(entry, collectionIds, byId, "lexical"));
    report("LEXICAL ONLY (portuguese full-text over chunk + title, no vector)", lexical);
    console.log(
      "\nNote: this is the lexical half in isolation, NOT the shipped hybrid — the dense half\n" +
        "can only add recall on top of it. Run without --lexical-only for the real number.",
    );
    return;
  }

  const hybrid: CaseResult[] = [];
  for (const entry of cases) hybrid.push(await runCase(entry, collectionIds, byId, "hybrid"));
  const hybridSummary = report("HYBRID (shipped: vector + portuguese full-text, fused by RRF)", hybrid);

  if (flag("compare")) {
    const dense: CaseResult[] = [];
    for (const entry of cases) dense.push(await runCase(entry, collectionIds, byId, "dense"));
    const denseSummary = report("DENSE ONLY (pre-0062: pure cosine)", dense);

    const delta = hybridSummary.recall - denseSummary.recall;
    const mrrDelta = hybridSummary.mrr - denseSummary.mrr;
    console.log(
      `\nWHAT THE HYBRID BOUGHT: recall@${K} ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp · ` +
        `MRR ${mrrDelta >= 0 ? "+" : ""}${mrrDelta.toFixed(3)}`,
    );
    const rescued = hybrid.filter(
      (result, index) => result.hitRank !== null && dense[index].hitRank === null,
    );
    if (rescued.length > 0) {
      console.log(`  cases only the lexical half finds (${rescued.length}):`);
      for (const result of rescued) console.log(`    ${result.entry.id} — "${result.entry.query}"`);
    }
    const lost = hybrid.filter((result, index) => result.hitRank === null && dense[index].hitRank !== null);
    if (lost.length > 0) {
      console.log(`  cases the fusion LOST (${lost.length}) — investigate before shipping further tuning:`);
      for (const result of lost) console.log(`    ${result.entry.id} — "${result.entry.query}"`);
    }
  }

  const identifierRecall = summarize(hybrid.filter((result) => result.entry.tier === "identifier")).recall;
  if (identifierRecall < 1) {
    console.error(
      `\nFAIL: identifier lookups are objectively checkable and must all resolve (recall ${pct(identifierRecall)}).`,
    );
    process.exit(1);
  }
  console.log("\nOK: every identifier lookup resolved.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
