# @flyee/ai

Instruction-driven AI assistants behind a `ChatProvider` interface.

## Concept

The chat UI never talks to "an AI" — it talks to an **assistant**: a row in the `assistants` table (see `packages/db/migrations/0002_ai.sql`) holding the system instructions, provider, model, temperature, token limit and per-message credit cost. Superadmins create/edit assistants at runtime in `/admin/ai`; no deploy needed. The template seeds an example `product-assistant` meant to be replaced.

## Providers

| | Anthropic | Gemini | OpenAI | OpenRouter |
|---|---|---|---|---|
| Model field | e.g. `claude-sonnet-5` | e.g. `gemini-2.5-flash` | native id, e.g. `gpt-4o`, `o4-mini` | **required** full id, e.g. `openai/gpt-4o` |
| Images | ✅ base64 blocks | ✅ inlineData | ✅ data URLs | ✅ data URLs (most models) |
| Audio | ❌ (no API audio input) | ✅ native | ✅ on audio models only (`gpt-4o-audio-preview`, `gpt-audio`) | model-dependent (attempted; provider errors surface) |
| Streaming | ✅ | ✅ | ✅ (SSE) | ✅ (SSE) |

Audio for Anthropic-backed assistants: route the assistant through Gemini, or add a transcription step (future `packages/jobs`).

**OpenAI vs OpenRouter.** OpenRouter already proxies OpenAI models, so the direct provider is not about reach — it is about the ACCOUNT and the PARAMETERS. Direct means the practice's own OpenAI billing, rate limits and data-retention terms instead of a reseller's, and only there do the reasoning-family rules apply: `o1`/`o3`/`o4`/`gpt-5` reject `temperature` and take `max_completion_tokens` instead of `max_tokens`, which the provider handles for you. Tell them apart by the model id: a vendor prefix (`openai/gpt-4o`) means OpenRouter, a bare id (`gpt-4o`) means direct.

`OPENAI_BASE_URL` overrides the API host, so an Azure/proxy deployment speaking the same dialect works without a code change.

## Structured outputs

`provider.generateStructured(config, messages, { name, description, schema })` returns a **JSON object validated against a JSON Schema** instead of free text — how derived projects enforce mandatory answer formats (diagnosis/evidence/action reports, extraction, classification). Not streamed.

Per provider: Anthropic uses forced tool use (`tool_choice`), Gemini uses `responseJsonSchema` (Gemini 2.5+), OpenRouter uses `response_format: json_schema` (model support varies; unsupported models surface a provider error).

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

The clinical reasoning and therapeutic plan DO use this interface and honour `REASONING_PROVIDER` / `REASONING_MODEL`, so those can run on OpenAI today.
