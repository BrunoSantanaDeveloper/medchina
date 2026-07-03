-- ============================================================
-- 0002_ai: instruction-driven AI assistants (superadmin-managed),
-- per-organization conversations/messages, and a private storage
-- bucket for image/audio attachments.
-- ============================================================

create type public.ai_provider as enum ('anthropic', 'gemini', 'openrouter');

-- ---------- Assistants (the "specific instructions" layer) ----------

create table public.assistants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  provider public.ai_provider not null default 'anthropic',
  -- Required. For openrouter this is the full model id (e.g.
  -- "anthropic/claude-sonnet-5"); for anthropic/gemini the native id.
  model text not null,
  -- The behavior contract: every chat with this assistant obeys these
  -- instructions. Edited by superadmins at runtime, no deploy needed.
  system_prompt text not null,
  temperature numeric(3, 2) not null default 0.7,
  max_tokens integer not null default 2048,
  -- Debited from the organization credit ledger on every user message.
  credits_per_message integer not null default 0,
  -- Reserved for future tools/RAG configuration.
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Conversations and messages (org-scoped) ----------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id uuid not null references public.assistants (id),
  created_by uuid not null references public.profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_org_idx on public.conversations (org_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- [{"kind": "image"|"audio", "path": "<storage path>", "mime": "..."}]
  attachments jsonb not null default '[]'::jsonb,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id);

-- ---------- RLS ----------

alter table public.assistants enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "assistants_select" on public.assistants for select to authenticated
  using (is_active or public.is_superadmin());
create policy "assistants_all_superadmin" on public.assistants for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create policy "conversations_select_member" on public.conversations for select to authenticated
  using (public.is_org_member(org_id));
create policy "conversations_insert_member" on public.conversations for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = auth.uid());
create policy "conversations_update_member" on public.conversations for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "conversations_delete_creator" on public.conversations for delete to authenticated
  using (created_by = auth.uid() or public.is_superadmin());

create policy "messages_select_member" on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and public.is_org_member(c.org_id)
    )
  );
create policy "messages_insert_member" on public.messages for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and public.is_org_member(c.org_id)
    )
  );

-- ---------- Attachments bucket (private; path: <org_id>/...) ----------

insert into storage.buckets (id, name, public) values ('ai-attachments', 'ai-attachments', false);

create policy "ai_attachments_select_member" on storage.objects for select to authenticated
  using (bucket_id = 'ai-attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "ai_attachments_insert_member" on storage.objects for insert to authenticated
  with check (bucket_id = 'ai-attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "ai_attachments_delete_member" on storage.objects for delete to authenticated
  using (bucket_id = 'ai-attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid));

-- ---------- updated_at maintenance ----------

create trigger assistants_updated_at
  before update on public.assistants
  for each row execute function public.set_updated_at();

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------- Seed: example assistant (replace in derived projects) ----------

insert into public.assistants (slug, name, description, provider, model, system_prompt, sort)
values (
  'product-assistant',
  'Product Assistant',
  'Example assistant seeded by the template — edit or replace its instructions in /admin/ai.',
  'anthropic',
  'claude-sonnet-5',
  'You are the in-app assistant for this product. Answer questions about how to use the application, be concise and practical, and reply in the language the user writes in. If you are asked about something unrelated to the product or outside your knowledge, say so briefly instead of guessing. This is a template placeholder instruction set: derived projects must replace it with product-specific instructions.',
  0
);
