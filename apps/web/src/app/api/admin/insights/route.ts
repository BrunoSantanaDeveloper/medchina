import { NextResponse } from "next/server";
import postgres from "postgres";

import { aiSpendMeter } from "@/lib/ai-spend";
import { recordAudit } from "@/lib/audit";
import {
  type AiProviderName,
  type ChatMessage,
  getChatProvider,
  isAnthropicConfigured,
  isGeminiConfigured,
  isOpenRouterConfigured,
} from "@flyee/ai";
import { createClient } from "@flyee/auth/server";

export const maxDuration = 60;

/** Each provider's fast reasoning tier. */
const PROVIDERS: { name: AiProviderName; model: string; enabled: boolean }[] = [
  { name: "gemini", model: "gemini-3.6-flash", enabled: isGeminiConfigured },
  { name: "anthropic", model: "claude-sonnet-5-5", enabled: isAnthropicConfigured },
  { name: "openrouter", model: "anthropic/claude-sonnet-4.5", enabled: isOpenRouterConfigured },
];

/**
 * Gemini, unless INSIGHTS_PROVIDER names another provider.
 *
 * The answers are built from production query results, so where they go is a
 * decision, never a side effect. The first configured provider used to win,
 * Anthropic first: merely adding ANTHROPIC_API_KEY (to try Claude on one
 * clinical feature) silently started sending those results to a second
 * processor — and to a model this account cannot even call. INSIGHTS_MODEL
 * only counts together with INSIGHTS_PROVIDER, so a model id never lands on a
 * provider nobody named.
 */
function insightsProvider() {
  const named = process.env.INSIGHTS_PROVIDER;
  const chosen = PROVIDERS.find((entry) => entry.name === (named || "gemini") && entry.enabled);
  return chosen && named && process.env.INSIGHTS_MODEL ? { ...chosen, model: process.env.INSIGHTS_MODEL } : chosen;
}

/** How many SQL round-trips the model gets before it must answer. */
const MAX_ROUNDS = 4;
/** The most one round may take, even with time left. */
const ROUND_TIMEOUT_MS = 25_000;
/** A round that cannot get this much is not started. */
const MIN_ROUND_MS = 8_000;
/** Kept at the end of the route's time to answer and close the connection. */
const CLOSING_MS = 5_000;
const ROW_LIMIT = 500;
const STATEMENT_TIMEOUT_MS = 5000;

const STEP_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["sql", "final"],
      description: "Run another read-only query, or answer the question now.",
    },
    sql: { type: "string", description: "A single read-only SELECT statement (required when action = sql)." },
    answer: {
      type: "string",
      description: "The answer in the user's language, citing the numbers found (required when action = final).",
    },
  },
  required: ["action"],
} as const;

type Step = { action: "sql" | "final"; sql?: string; answer?: string };

let catalogCache: string | null = null;

/** Compact `table(column type, ...)` listing of the public schema for the prompt. */
async function loadCatalog(sql: postgres.Sql): Promise<string> {
  if (catalogCache) return catalogCache;
  const columns = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `;
  const tables = new Map<string, string[]>();
  for (const column of columns) {
    const entry = tables.get(column.table_name) ?? [];
    entry.push(`${column.column_name} ${column.data_type}`);
    tables.set(column.table_name, entry);
  }
  catalogCache = [...tables.entries()].map(([table, cols]) => `${table}(${cols.join(", ")})`).join("\n");
  return catalogCache;
}

const systemPrompt = (catalog: string) => `You are the data analyst for a SaaS platform's superadmin.
You answer questions about the production database by writing PostgreSQL queries.

Schema (table(column type, ...)):
${catalog}

Rules:
- Emit ONE read-only SELECT per step. Never write: the connection runs in a READ ONLY transaction, so INSERT/UPDATE/DELETE/DDL (including data-modifying CTEs) fail.
- Always constrain result size (aggregate, or LIMIT ${ROW_LIMIT}).
- Time windows use the relevant created_at column, e.g. created_at >= now() - interval '7 days'.
- Money is stored in cents (price_cents, amount_cents) — convert to a currency amount when reporting.
- If a query errors, read the message and correct it in the next step.
- When you have the numbers, answer with action "final": a direct sentence with the figures, in the language the question was asked. No preamble, no SQL in the answer.`;

type InsightsRequest = { question: string };

export async function POST(request: Request) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticada." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  if (!profile?.is_superadmin) return NextResponse.json({ error: "Restrito a superadmins." }, { status: 403 });

  const provider = insightsProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error: process.env.INSIGHTS_PROVIDER
          ? `INSIGHTS_PROVIDER="${process.env.INSIGHTS_PROVIDER}" não está disponível — confira o nome (gemini, anthropic ou openrouter) e a chave desse provedor.`
          : "Nenhum provedor de IA configurado. Defina GEMINI_API_KEY — ou escolha outro provedor com INSIGHTS_PROVIDER e a chave dele.",
      },
      { status: 503 },
    );
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: "DATABASE_URL não está definida — os insights consultam o banco diretamente." },
      { status: 503 },
    );
  }

  const { question } = (await request.json()) as InsightsRequest;
  if (!question?.trim()) return NextResponse.json({ error: "Pergunta vazia." }, { status: 400 });

  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const chat = getChatProvider(provider.name);
  const steps: { sql: string; rowCount: number; error?: string }[] = [];

  try {
    const config = {
      provider: provider.name,
      model: provider.model,
      systemPrompt: systemPrompt(await loadCatalog(sql)),
      temperature: 0,
      maxTokens: 2048,
      effort: "low" as const,
    };
    const messages: ChatMessage[] = [{ role: "user", content: question }];
    let outOfTime = false;

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      // Every round shares this route's maxDuration. Each one gets what is
      // left of it (capped), so a slow provider fails here with a reason
      // instead of the platform killing the route mid-answer.
      const left = maxDuration * 1000 - CLOSING_MS - (Date.now() - startedAt);
      if (left < MIN_ROUND_MS) {
        outOfTime = true;
        break;
      }

      // The operator asking the database questions is the platform spending
      // its own money: org NULL, so no workspace is billed for it. A dozen
      // rounds of a 2k-token prompt is not free, and this is the only place
      // that cost could otherwise hide.
      const meter = aiSpendMeter({
        orgId: null,
        feature: "insights",
        provider: provider.name,
        model: provider.model,
        client: supabase,
      });
      const step = (await chat.generateStructured(
        { ...config, timeoutMs: Math.min(ROUND_TIMEOUT_MS, left) },
        messages,
        {
          name: "analyst_step",
          description: "Run a read-only query, or give the final answer.",
          schema: STEP_SCHEMA as unknown as Record<string, unknown>,
        },
        meter.sink,
      )) as Step;
      await meter.settled();

      if (step.action === "final" || !step.sql) {
        return NextResponse.json({ answer: step.answer ?? "Não cheguei a uma resposta.", steps });
      }

      // The READ ONLY transaction is the safety boundary — not prompt wording.
      // Postgres itself rejects any write the model might emit.
      let rows: unknown[] = [];
      let failure: string | null = null;
      try {
        rows = await sql.begin("read only", async (tx) => {
          await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
          return tx.unsafe(step.sql!);
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      const capped = rows.slice(0, ROW_LIMIT);
      steps.push({ sql: step.sql, rowCount: capped.length, error: failure ?? undefined });
      recordAudit(supabase, "admin.insights.query", {
        entityType: "sql",
        metadata: { question, sql: step.sql, error: failure },
      });

      messages.push({ role: "assistant", content: `Query:\n${step.sql}` });
      messages.push({
        role: "user",
        content: failure
          ? `The query failed: ${failure}\nFix it and try again.`
          : `Result (${capped.length} row${capped.length === 1 ? "" : "s"}):\n${JSON.stringify(capped)}`,
      });
    }

    return NextResponse.json(
      {
        answer: outOfTime
          ? "O tempo da consulta acabou antes de chegar a uma resposta. Tente estreitar a pergunta."
          : "Esgotei as tentativas de consulta antes de chegar a uma resposta. Tente estreitar a pergunta.",
        steps,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Insights failed.";
    return NextResponse.json({ error: message, steps }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
