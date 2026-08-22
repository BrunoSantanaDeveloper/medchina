-- ============================================================
-- 0088_mcp_conectores
--
-- MedChina como servidor MCP remoto: usuários de ChatGPT/Claude conectam o
-- workspace via OAuth 2.1 e consultam a biblioteca de MTC e o prontuário pelos
-- próprios apps (docs/MCP-CONECTORES.md). A geração da resposta acontece no
-- modelo do CLIENTE (pago pela assinatura de consumidor da profissional) — o
-- MedChina só executa recuperação, e por isso o consumo via MCP tem peso com
-- desconto na MESMA franquia mensal da biblioteca.
--
-- Quatro peças, nesta ordem:
--   1) O ledger `library_usage` (0063) ganha peso: uma mensagem in-app pesa
--      1.0, uma consulta MCP de recuperação pesa o que platform_settings
--      disser (0.1 no seed). A franquia continua UMA só.
--   2) O authorization server: clientes registrados dinamicamente (RFC 7591),
--      códigos com PKCE S256 e tokens opacos com hash — a mesma disciplina de
--      `capture_links` (0053): o segredo nunca é persistido, só o SHA-256.
--   3) `mcp_requests`: uma linha por chamada de tool, que é ao mesmo tempo a
--      janela do rate limit e a trilha fina de volume (o evento clínico
--      continua indo para audit_events).
--   4) Configuração em dados: pesos e rate em platform_settings ('mcp'),
--      disponibilidade por plano em plans.limits.mcp_access — nunca em código.
-- ============================================================

-- ---------- 1) Peso no ledger da biblioteca ----------

alter table public.library_usage
  add column if not exists channel text not null default 'library_chat'
    check (channel in ('library_chat', 'mcp')),
  add column if not exists tool text,
  add column if not exists weight numeric(6,3) not null default 1.0
    check (weight >= 0);

comment on column public.library_usage.channel is
  'Origem do consumo: chat in-app da biblioteca ou tool chamada via conector MCP.';
comment on column public.library_usage.tool is
  'Nome da tool MCP que consumiu (null no chat in-app).';
comment on column public.library_usage.weight is
  'Fração da franquia mensal consumida por esta linha (in-app = 1.0; MCP com desconto).';

create index if not exists library_usage_channel_idx
  on public.library_usage (org_id, channel, created_at desc);

-- Idêntica à 0063 exceto pelo medidor: `used` passa de count(*) para
-- sum(weight). Linhas antigas têm weight 1.0, então nenhum contador muda no
-- deploy. Janela, dunning e os `reason` nomeados são preservados na íntegra.
create or replace function public.org_message_allowance(target_org uuid, target_assistant text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  helper public.assistants%rowtype;
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  quota_key text;
  limit_messages integer;
  used_messages numeric := 0;
  window_start timestamptz := date_trunc('month', now());
  suspended boolean := false;
  grace_ends timestamptz;
  in_grace boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into helper from public.assistants where slug = target_assistant and is_active;
  if helper.id is null then
    raise exception 'assistant not found';
  end if;

  quota_key := helper.config ->> 'quota_limit_key';
  if quota_key is null then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  suspended := coalesce(sub.admin_suspended, false);
  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  if sub.id is null then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'no_plan');
  end if;
  if suspended then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'suspended');
  end if;
  if sub.status not in ('trialing', 'active') and not in_grace then
    return jsonb_build_object(
      'allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'past_due_blocked'
    );
  end if;

  select * into plan from public.plans where id = sub.plan_id;
  limit_messages := (plan.limits ->> quota_key)::int;
  if limit_messages is null then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  -- Mês calendário, ledger append-only (0063). Soma de pesos: uma consulta MCP
  -- de recuperação consome uma fração da franquia porque a parte cara — gerar
  -- a resposta — acontece no modelo do cliente, não no nosso.
  select coalesce(sum(u.weight), 0) into used_messages
  from public.library_usage u
  where u.org_id = target_org
    and u.assistant_id = helper.id
    and u.created_at >= window_start;

  return jsonb_build_object(
    'allowed', used_messages < limit_messages,
    'unlimited', false,
    'used', round(used_messages, 1),
    'limit', limit_messages,
    'window_start', window_start,
    'reason', case when used_messages < limit_messages then 'ok' else 'quota_exhausted' end
  );
end;
$$;

revoke all on function public.org_message_allowance(uuid, text) from public, anon;
grant execute on function public.org_message_allowance(uuid, text) to authenticated, service_role;

-- Assinatura nova (canal/tool/peso com default) — o overload antigo é REMOVIDO
-- porque mantê-lo tornaria a chamada nomeada de 4 argumentos ambígua para o
-- PostgREST. Os call sites existentes seguem válidos via defaults.
drop function if exists public.record_library_usage(uuid, text, uuid, uuid);

create or replace function public.record_library_usage(
  target_org uuid,
  target_assistant text,
  target_conversation uuid,
  target_user uuid default null,
  target_channel text default 'library_chat',
  target_tool text default null,
  target_weight numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  helper public.assistants%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_channel not in ('library_chat', 'mcp') then
    return jsonb_build_object('ok', false, 'code', 'invalid_channel');
  end if;
  if target_weight is null or target_weight < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_weight');
  end if;

  select * into helper from public.assistants where slug = target_assistant;
  if helper.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.library_usage (org_id, assistant_id, conversation_id, user_id, channel, tool, weight)
  values (target_org, helper.id, target_conversation, target_user, target_channel, target_tool, target_weight);

  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_library_usage(uuid, text, uuid, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.record_library_usage(uuid, text, uuid, uuid, text, text, numeric)
  to service_role;

-- ---------- 2) OAuth: clientes, códigos, tokens ----------

-- Apps clientes registrados dinamicamente (RFC 7591). Sem org de propósito: o
-- registro é do APP (ChatGPT, Claude), não de um workspace — o vínculo com o
-- workspace nasce no grant. Escrita e leitura só pelo service role: o conteúdo
-- inclui redirect URIs que são superfície de ataque, não dado do tenant.
create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none'
    check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  -- Só quando o método de autenticação exige segredo; sempre o hash, nunca o valor.
  client_secret_hash text,
  client_uri text,
  logo_uri text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.oauth_clients is
  'Apps clientes OAuth (ChatGPT, Claude) registrados via RFC 7591 para o servidor MCP. Service-role only.';

alter table public.oauth_clients enable row level security;
revoke all on table public.oauth_clients from public, anon, authenticated;
-- Superadmin console reads names/registrations; members still get nothing
-- (grant + a superadmin-only policy — RLS denies everyone else).
grant select on table public.oauth_clients to authenticated;
drop policy if exists oauth_clients_select_superadmin on public.oauth_clients;
create policy oauth_clients_select_superadmin
  on public.oauth_clients for select to authenticated
  using (public.is_superadmin());

select public.enable_row_versioning('public.oauth_clients');

-- Códigos de autorização: vida curta (5 min), uso único, PKCE S256 obrigatório.
-- Só o hash do código é persistido — o valor viaja uma vez no redirect.
create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.oauth_clients (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null unique,
  code_challenge text not null,
  code_challenge_method text not null default 'S256'
    check (code_challenge_method = 'S256'),
  redirect_uri text not null,
  scope text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.oauth_grants is
  'Códigos de autorização OAuth do servidor MCP (uso único, PKCE). Service-role only.';

alter table public.oauth_grants enable row level security;
revoke all on table public.oauth_grants from public, anon, authenticated;

-- Tokens emitidos: access 1h / refresh 30d, rotação a cada refresh, sempre
-- hashes. Membros LEEM as conexões do próprio workspace (a tela "apps
-- conectados" em /settings) — revogar passa por rota server-side, nunca por
-- update direto.
create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.oauth_clients (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  scope text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.oauth_tokens is
  'Tokens do servidor MCP (opacos; só hashes). Membros leem as conexões do workspace; escrita só pelo service role.';

create index if not exists oauth_tokens_org_idx
  on public.oauth_tokens (org_id, created_at desc);

alter table public.oauth_tokens enable row level security;
revoke all on table public.oauth_tokens from public, anon;
grant select on table public.oauth_tokens to authenticated;
revoke insert, update, delete, truncate on table public.oauth_tokens from authenticated;

drop policy if exists oauth_tokens_select_member on public.oauth_tokens;
create policy oauth_tokens_select_member
  on public.oauth_tokens for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

-- ---------- 3) Rate limit + trilha por chamada ----------

-- Uma linha por chamada de tool. Agentes encadeiam dezenas de chamadas numa
-- conversa só; sem esta janela o endpoint viraria API gratuita ilimitada.
-- Append-only, service-role only — o mesmo desenho de audio_usage/library_usage.
create table if not exists public.mcp_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_id uuid references public.oauth_tokens (id) on delete set null,
  tool text not null,
  status text not null default 'ok'
    check (status in ('ok', 'denied_entitlement', 'denied_scope', 'denied_quota', 'denied_rate', 'denied_consent', 'error')),
  created_at timestamptz not null default now()
);

comment on table public.mcp_requests is
  'Uma linha por chamada de tool MCP: janela do rate limit + trilha de volume. Service-role writes only.';

create index if not exists mcp_requests_window_idx
  on public.mcp_requests (org_id, created_at desc);

alter table public.mcp_requests enable row level security;
revoke all on table public.mcp_requests from public, anon;
grant select on table public.mcp_requests to authenticated;
revoke insert, update, delete, truncate on table public.mcp_requests from authenticated;

drop policy if exists mcp_requests_select_member on public.mcp_requests;
create policy mcp_requests_select_member
  on public.mcp_requests for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

-- Janela deslizante sobre o ledger: só chamadas ATENDIDAS contam (uma negação
-- não consome a janela — senão um cliente com bug ficaria preso para sempre).
-- Limites vêm de platform_settings 'mcp'; defaults cobrem a chave ausente.
create or replace function public.mcp_rate_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  settings jsonb;
  per_minute integer;
  per_hour integer;
  used_minute integer;
  used_hour integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_superadmin() then
    raise exception 'not authorized';
  end if;

  select value into settings from public.platform_settings where key = 'mcp';
  per_minute := coalesce((settings -> 'rate' ->> 'per_minute')::int, 20);
  per_hour := coalesce((settings -> 'rate' ->> 'per_hour')::int, 200);

  select count(*) into used_minute
  from public.mcp_requests
  where org_id = target_org and status = 'ok' and created_at >= now() - interval '1 minute';

  select count(*) into used_hour
  from public.mcp_requests
  where org_id = target_org and status = 'ok' and created_at >= now() - interval '1 hour';

  return jsonb_build_object(
    'allowed', used_minute < per_minute and used_hour < per_hour,
    'per_minute_used', used_minute,
    'per_minute_limit', per_minute,
    'per_hour_used', used_hour,
    'per_hour_limit', per_hour
  );
end;
$$;

revoke all on function public.mcp_rate_allowance(uuid) from public, anon, authenticated;
grant execute on function public.mcp_rate_allowance(uuid) to service_role;

-- ---------- 4) Configuração em dados ----------

-- Pesos por tool e rate limit: política da plataforma, editável no admin sem
-- deploy. Tool ausente do mapa paga default_weight (1.0) — o fail-safe é na
-- direção de COBRAR: uma tool futura que gere conteúdo com o NOSSO modelo não
-- ganha desconto por esquecimento.
insert into public.platform_settings (key, value)
values ('mcp', jsonb_build_object(
  'enabled', true,
  'weights', jsonb_build_object(
    'consultar_biblioteca_mtc', 0.1,
    'buscar_paciente', 0,
    'resumo_prontuario', 0,
    'proximas_consultas', 0
  ),
  'default_weight', 1.0,
  'rate', jsonb_build_object('per_minute', 20, 'per_hour', 200)
))
on conflict (key) do nothing;

-- Disponibilidade por plano. Gratuito fica de fora no lançamento (alavanca de
-- upgrade) — ligar depois é um update em plans.limits no /admin/billing.
update public.plans set limits = limits || '{"mcp_access": 1}'::jsonb
  where slug in ('assistente', 'pro');
update public.plans set limits = limits || '{"mcp_access": 0}'::jsonb
  where slug = 'gratuito';

-- Termo que a profissional aceita na tela de autorização: os dados retornados
-- pelas tools trafegam pela conta pessoal dela de ChatGPT/Claude, fora do DPA
-- do MedChina. Versionado como todo consentimento (0005).
insert into public.consent_terms (slug, version, title, body, is_active) values
  (
    'external-assistant', 1,
    'Conexão com assistente externo (ChatGPT / Claude)',
    'Autorizo a conexão deste workspace ao assistente externo indicado, por meio da qual '
    'as informações que eu solicitar — conteúdos da biblioteca de MTC e, quando eu pedir, '
    'dados de prontuário de pacientes com consentimento ativo de processamento por IA — '
    'serão enviadas ao aplicativo do assistente e processadas pela minha conta pessoal '
    'nesse serviço, fora da infraestrutura do MedChina. Compreendo que o tratamento desses '
    'dados pelo serviço externo segue os termos e a política de privacidade do provedor do '
    'assistente, que permaneço responsável pelo sigilo profissional das informações que '
    'consulto por esse canal, e que posso revogar esta conexão a qualquer momento em '
    'Configurações. Todo conteúdo retornado é apoio à revisão profissional — nunca '
    'diagnóstico ou prescrição. '
    '(Texto provisório — pendente de revisão jurídica.)',
    true
  )
on conflict (slug, version) do nothing;
