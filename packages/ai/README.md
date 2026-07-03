# @gogo/ai

Instruction-driven AI assistants behind a `ChatProvider` interface.

## Concept

The chat UI never talks to "an AI" — it talks to an **assistant**: a row in the `assistants` table (see `packages/db/migrations/0002_ai.sql`) holding the system instructions, provider, model, temperature, token limit and per-message credit cost. Superadmins create/edit assistants at runtime in `/admin/ai`; no deploy needed. The template seeds an example `product-assistant` meant to be replaced.

## Providers

| | Anthropic | Gemini | OpenRouter |
|---|---|---|---|
| Model field | e.g. `claude-sonnet-5` | e.g. `gemini-2.5-flash` | **required** full id, e.g. `openai/gpt-4o` |
| Images | ✅ base64 blocks | ✅ inlineData | ✅ data URLs (most models) |
| Audio | ❌ (no API audio input) | ✅ native | model-dependent (attempted; provider errors surface) |
| Streaming | ✅ | ✅ | ✅ (SSE) |

Audio for Anthropic-backed assistants: route the assistant through Gemini, or add a transcription step (future `packages/jobs`).

## Structured outputs

`provider.generateStructured(config, messages, { name, description, schema })` returns a **JSON object validated against a JSON Schema** instead of free text — how derived projects enforce mandatory answer formats (diagnosis/evidence/action reports, extraction, classification). Not streamed.

Per provider: Anthropic uses forced tool use (`tool_choice`), Gemini uses `responseJsonSchema` (Gemini 2.5+), OpenRouter uses `response_format: json_schema` (model support varies; unsupported models surface a provider error).

## Knowledge grounding

Assistants with `config.knowledge` (see `packages/knowledge/README.md`) get retrieved excerpts appended to their system prompt, labeled by trust level, with instructions to cite `[n]` and never invent evidence.

## Flow (`/api/ai/chat` in apps/web)

1. Auth + assistant lookup (RLS exposes active ones only).
2. `org_entitlements()` gate: suspended/no subscription → 402.
3. `consume_credits()` debits `credits_per_message` from the org ledger — credit plans from `@gogo/billing` are the AI usage currency.
4. Conversation + messages persisted per organization (RLS).
5. Attachments live in the private `ai-attachments` bucket (`<org_id>/...` paths, member-only policies); the latest message's files are sent to the model as base64.
6. The reply streams as plain text; `X-Conversation-Id` header carries the conversation.

## Env vars (apps/web/.env)

```
ANTHROPIC_API_KEY=   GEMINI_API_KEY=   OPENROUTER_API_KEY=
```

An assistant whose provider has no key fails with a clear error; other assistants keep working.
