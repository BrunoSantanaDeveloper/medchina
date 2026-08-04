-- ============================================================
-- 0067_openai_provider
--
-- Adds OpenAI (direct) to the assistant provider enum, alongside Anthropic,
-- Gemini and OpenRouter (0002).
--
-- OpenRouter already proxies OpenAI models, so this is not about reach — it is
-- about the account and the parameters. Going direct means the practice's own
-- OpenAI billing and rate limits instead of a reseller's, and the reasoning
-- family (o-series / gpt-5) has parameter rules that only apply on the native
-- API. Keeping them as two providers means an assistant declares which account
-- it runs on instead of a provider guessing.
--
-- `alter type ... add value` cannot run inside a transaction block in older
-- Postgres, hence `if not exists` and a standalone statement — the migration
-- runner applies files one statement at a time.
-- ============================================================

alter type public.ai_provider add value if not exists 'openai';

comment on type public.ai_provider is
  'Chat provider backing an assistant. Mirrors AiProviderName in packages/ai; adding one means adding a ChatProvider implementation too.';
