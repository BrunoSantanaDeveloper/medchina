/**
 * Re-embed the knowledge corpus through the CURRENT ingestion path.
 *
 *   node_modules/.bin/tsx scripts/reindex-knowledge.mts                    # dry run (default)
 *   node_modules/.bin/tsx scripts/reindex-knowledge.mts --apply
 *   node_modules/.bin/tsx scripts/reindex-knowledge.mts --apply --collection mtc-fontes-tradicionais
 *   node_modules/.bin/tsx scripts/reindex-knowledge.mts --apply --concurrency 2
 *
 * Until now the only way to re-index was the per-document button in
 * /admin/knowledge — 459 clicks, with the library degrading document by
 * document while it ran, which in practice meant it never happened. Anything
 * that changes how a chunk is built or embedded needs this: a new chunking
 * rule, a different embedding model, a change of output dimensions.
 *
 * DRY RUN BY DEFAULT, because --apply spends embedding quota and rewrites every
 * chunk row. It is safe to re-run: processDocument replaces a document's chunks
 * in place and is idempotent.
 *
 * A document is INVISIBLE to retrieval while it is being processed (the search
 * RPC filters status='ready'), so this walks documents one at a time by default
 * rather than blanking the corpus in one transaction.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { processDocument } from "../packages/knowledge/src/ingest.ts";

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

const APPLY = flag("apply");
const CONCURRENCY = Math.max(1, Number(option("concurrency") ?? 1));
const COLLECTION = option("collection");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (APPLY && !process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY — --apply needs it to embed.");
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  let collectionIds: string[] | null = null;
  if (COLLECTION) {
    const { data, error } = await supabase.from("knowledge_collections").select("id").eq("slug", COLLECTION);
    if (error) throw new Error(error.message);
    collectionIds = (data ?? []).map((row) => row.id as string);
    if (collectionIds.length === 0) throw new Error(`No collection with slug "${COLLECTION}".`);
  }

  let query = supabase.from("knowledge_documents").select("id, title, status, collection_id").order("title");
  if (collectionIds) query = query.in("collection_id", collectionIds);
  const { data: documents, error } = await query;
  if (error) throw new Error(error.message);

  const { count: chunkCount } = await supabase.from("knowledge_chunks").select("id", { count: "exact", head: true });

  console.log(
    `${documents?.length ?? 0} documents${COLLECTION ? ` in ${COLLECTION}` : ""} · ${chunkCount ?? "?"} chunks today`,
  );

  if (!APPLY) {
    const byStatus = new Map<string, number>();
    for (const document of documents ?? []) {
      byStatus.set(document.status as string, (byStatus.get(document.status as string) ?? 0) + 1);
    }
    console.log("status:", Object.fromEntries(byStatus));
    console.log(
      "\nDRY RUN — nothing was read from the embedding API and nothing was written.\n" +
        "Re-run with --apply to re-embed. Every document is briefly invisible to\n" +
        "retrieval while its own chunks are replaced.",
    );
    return;
  }

  const queue = [...(documents ?? [])];
  let done = 0;
  let failed = 0;
  const started = Date.now();

  const worker = async () => {
    for (;;) {
      const document = queue.shift();
      if (!document) return;
      const result = await processDocument(supabase, document.id as string);
      done += 1;
      if (!result.ok) {
        failed += 1;
        console.error(`  ✗ ${document.title}: ${result.error}`);
      } else if (done % 25 === 0 || done === (documents?.length ?? 0)) {
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.log(`  ${done}/${documents?.length ?? 0} (${elapsed}s)`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const { count: after } = await supabase.from("knowledge_chunks").select("id", { count: "exact", head: true });
  console.log(`\nDone: ${done} documents, ${failed} failed · ${after ?? "?"} chunks now`);
  if (failed > 0) {
    console.error("Some documents failed — they are marked status='error' and stay OUT of retrieval until fixed.");
    process.exit(1);
  }
  console.log("Re-run scripts/eval-retrieval.mts to see what changed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
