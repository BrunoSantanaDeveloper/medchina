-- ============================================================
-- 0007_transcriptions: audio -> diarized transcript pipeline.
-- Audio is uploaded to the private "transcriptions" bucket, a job
-- transcribes it (speaker separation + timestamps) and, when
-- delete_audio_after is set, the source audio is removed once the
-- transcript is ready (retention by design — e.g. consultation
-- recordings that must not outlive their validated transcript).
-- ============================================================

create table public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Path inside the "transcriptions" bucket; nulled after retention delete.
  audio_path text,
  mime text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'error')),
  error text,
  -- Remove the source audio as soon as the transcript is ready.
  delete_audio_after boolean not null default false,
  -- { "language": "...", "segments": [{ "speaker", "start", "text" }] }
  result jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transcriptions_org_idx on public.transcriptions (org_id, created_at desc);

-- ---------- RLS ----------

alter table public.transcriptions enable row level security;

create policy "transcriptions_select_member" on public.transcriptions for select to authenticated
  using (public.is_org_member(org_id));
create policy "transcriptions_insert_member" on public.transcriptions for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = auth.uid());
create policy "transcriptions_update_member" on public.transcriptions for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "transcriptions_delete_creator" on public.transcriptions for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
  );

-- ---------- Storage bucket (private; path: <org_id>/...) ----------

insert into storage.buckets (id, name, public) values ('transcriptions', 'transcriptions', false);

create policy "transcriptions_bucket_select_member" on storage.objects for select to authenticated
  using (bucket_id = 'transcriptions' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "transcriptions_bucket_insert_member" on storage.objects for insert to authenticated
  with check (bucket_id = 'transcriptions' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "transcriptions_bucket_delete_member" on storage.objects for delete to authenticated
  using (bucket_id = 'transcriptions' and public.is_org_member(((storage.foldername(name))[1])::uuid));

-- ---------- updated_at maintenance ----------

create trigger transcriptions_updated_at
  before update on public.transcriptions
  for each row execute function public.set_updated_at();
