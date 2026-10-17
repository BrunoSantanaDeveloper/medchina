# @flyee/ai

Instruction-driven AI assistants behind a `ChatProvider` interface.

## Concept

The chat UI never talks to "an AI" — it talks to an **assistant**: a row in the `assistants` table (see `packages/db/migrations/0002_ai.sql`) holding the system instructions, provider, model, temperature, token limit and per-message credit cost. Superadmins create/edit assistants at runtime in `/admin/ai`; no deploy needed. The template seeds an example `product-assistant` meant to be replaced.

## Providers

|             | Anthropic                | Gemini                  | OpenAI                                                        | OpenRouter                                           |
| ----------- | ------------------------ | ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Model field | e.g. `claude-sonnet-5-5` | e.g. `gemini-3.6-flash` | native id, e.g. `gpt-4o`, `o4-mini`                           | **required** full id, e.g. `openai/gpt-4o`           |
| Images      | ✅ base64 blocks         | ✅ inlineData           | ✅ data URLs                                                  | ✅ data URLs (most models)                           |
| Audio       | ❌ (no API audio input)  | ✅ native               | ✅ on audio models only (`gpt-4o-audio-preview`, `gpt-audio`) | model-dependent (attempted; provider errors surface) |
| Streaming   | ✅                       | ✅                      | ✅ (SSE)                                                      | ✅ (SSE)                                             |

Audio for Anthropic-backed assistants: route the assistant through Gemini, or add a transcription step (future `packages/jobs`).

**OpenAI vs OpenRouter.** OpenRouter already proxies OpenAI models, so the direct provider is not about reach — it is about the ACCOUNT and the PARAMETERS. Direct means the practice's own OpenAI billing, rate limits and data-retention terms instead of a reseller's, and only there do the reasoning-family rules apply: `o1`/`o3`/`o4`/`gpt-5` reject `temperature` and take `max_completion_tokens` instead of `max_tokens`, which the provider handles for you. Tell them apart by the model id: a vendor prefix (`openai/gpt-4o`) means OpenRouter, a bare id (`gpt-4o`) means direct.

`OPENAI_BASE_URL` overrides the API host, so an Azure/proxy deployment speaking the same dialect works without a code change.

## Structured outputs

`provider.generateStructured(config, messages, { name, description, schema })` returns a **JSON object validated against a JSON Schema** instead of free text — how derived projects enforce mandatory answer formats (diagnosis/evidence/action reports, extraction, classification). Not streamed.

Per provider: Gemini uses `responseJsonSchema` (Gemini 2.5+), OpenRouter uses `response_format: json_schema` (model support varies; unsupported models surface a provider error), and Anthropic picks the strongest path the model and the schema allow — see below.

## Claude (Anthropic) — what the provider handles for you

The Claude 4.7+/5.x API rejects several things older code sends, each as a 400 on every call. `providers/anthropic.ts` applies the per-model rules in one place (`baseParams`), keyed on the model id, so an unknown newer id is treated as current:

- **Sampling.** `temperature` is dropped on the models that refuse it (4.7+, 5.x); the `/admin/ai` field says so.
- **Thinking depth.** `config.effort` (`low`…`max`) becomes `output_config.effort`, clamped to what the model takes. Adaptive thinking counts against `max_tokens`, so a reserve per effort level is added on top of the caller's answer budget — the same contract as Gemini's `reasoningBudget`. Omitted, the model's own default applies (Sonnet 5.5: `high`), which a caller with a deadline should not rely on.
- **Structured output.** Grammar-constrained JSON (`output_config.format`) when the schema fits the API's limits (24 optional properties, 16 union-typed ones — `anthropicSchemaComplexity`); otherwise a forced tool on the models that still accept `tool_choice`, otherwise the tool is offered with an instruction to call it; a text reply is parsed tolerantly as a last resort. Every path ends in the same `StructuredOutputError` vocabulary.
- **Refusals.** On the models that support it, a refusal falls back server-side to another model (`fallbacks: "default"`); each billed attempt is reported to the usage sink at its own model. A final refusal is `failure: "blocked"` with the category; `max_tokens` is `truncated`.
- **Deadline.** `config.timeoutMs` bounds the whole call, retries included (Gemini honours it too). Callers under a shared route deadline pass what is left of it.
- **Inputs.** PDFs go as document blocks; HEIC images are refused with a reason (the API does not take them); a conversation may not open with an assistant turn, so leading ones are dropped.

A chat stream (`streamChat`, Anthropic and Gemini) that was refused or cut at the token limit throws a `StructuredOutputError` AFTER the text it streamed: the caller decides what to do with it, and `/api/ai/chat` neither stores nor meters it as an answer. A stream that merely broke off (client gone, network) keeps what was already read.

## Usage reporting (what the call cost)

Both `streamChat` and `generateStructured` take an optional `onUsage` sink and call it with a `ChatUsage`: text
tokens in, everything billed as output (reasoning tokens included), and — where the provider separates it — audio
input tokens, which are priced apart. Once per call, except when one call billed several attempts (Claude's refusal
fallback): then once per attempt, each carrying the model that served it.

Two rules the providers follow, and any new provider must:

- **Report before the failure checks.** A call cut at `max_tokens`, refused by a safety filter, or returning invalid
  JSON was billed in full; a sink that only fires on success understates the bill.
- **Never let metering fail the call.** Every provider goes through `reportUsage()`, which swallows anything the sink
  throws. Bookkeeping does not get to break a consultation.

Callers in this repo hand the sink to `recordAiSpend` / `aiSpendMeter` (`apps/web/src/lib/ai-spend.ts`), which writes
the `ai_spend` ledger of migration 0115 and prices it in the database. A provider that cannot report usage simply
passes nothing: the call is then recorded as unpriced rather than as free.

## Knowledge grounding

Assistants with `config.knowledge` (see `packages/knowledge/README.md`) get retrieved excerpts appended to their system prompt, labeled by trust level, with instructions to cite `[n]` and never invent evidence.

## Flow (`/api/ai/chat` in apps/web)

1. Auth + assistant lookup (RLS exposes active ones only).
2. `org_entitlements()` gate: suspended/no subscription → 402.
3. `consume_credits()` debits `credits_per_message` from the org ledger — credit plans from `@flyee/billing` are the AI usage currency.
4. Conversation + messages persisted per organization (RLS).
5. Attachments live in the private `ai-attachments` bucket (`<org_id>/...` paths, member-only policies); the latest message's files are sent to the model as base64.
6. The reply streams as plain text; `X-Conversation-Id` header carries the conversation.

## Env vars (apps/web/.env)

```
ANTHROPIC_API_KEY=   GEMINI_API_KEY=   OPENAI_API_KEY=   OPENROUTER_API_KEY=
OPENAI_BASE_URL=                       # optional: Azure/proxy speaking the OpenAI API
```

An assistant whose provider has no key fails with a clear error; other assistants keep working. `/admin/ai` reads `GET /api/admin/ai/providers` (superadmin, booleans only) and warns **while the assistant is being edited** when the selected provider has no key — otherwise the missing key would surface later to a professional mid-appointment, as an error she cannot act on.

## What is NOT pluggable

Only the assistant CHAT layer goes through this interface. Two AI paths are deliberately bound to Gemini and changing them means more than a provider swap:

- **Transcription** (`packages/transcribe`) — diarized audio → transcript with per-segment timestamps, which the clinical provenance depends on.
- **Embeddings** (`packages/knowledge`) — `gemini-embedding-001` at 768 dimensions. The embedding space is baked into every stored vector: switching models requires RE-INDEXING the whole library, or retrieval returns nonsense.

The clinical features DO use this interface, each routed by its own variables (`apps/web/src/lib/ai-routing.ts`):

| Feature              | Own variables                                | Falls back to                                     |
| -------------------- | -------------------------------------------- | ------------------------------------------------- |
| Anamnesis extraction | `EXTRACTION_PROVIDER` / `_MODEL` / `_EFFORT` | Gemini, `TRANSCRIBE_MODEL` (never `REASONING_*`)  |
| Hypotheses           | `HYPOTHESES_*`                               | `REASONING_*`, then Gemini                        |
| Therapeutic plan     | `PLAN_*`                                     | `REASONING_*`, then Gemini                        |
| Clinical summary     | `SUMMARY_*`                                  | `REASONING_*` — except to Anthropic — then Gemini |
| Attachment reading   | `ATTACHMENT_*`                               | `REASONING_*` — except to Anthropic — then Gemini |

A provider named without a model gets its default (`gemini-3.6-flash`, `claude-sonnet-5-5`); a model is never inherited from another level. An unknown provider, or a model id that cannot belong to the provider it is paired with, throws naming the variable — running something else quietly would change the processor nobody chose. `/admin/insights` answers on Gemini unless `INSIGHTS_PROVIDER` (plus optional `INSIGHTS_MODEL`) names another.
