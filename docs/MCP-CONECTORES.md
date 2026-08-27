# Conectores MCP — MedChina dentro do ChatGPT e do Claude

> Status: **implementado** (F1–F5, 2026-08-22) — migração `0088_mcp_conectores.sql`
> criada e AINDA NÃO aplicada ao remoto; ver §8 (pós-deploy). F6 (diretórios
> oficiais) é processo externo.
> Decisão de produto que origina este plano: usuários de ChatGPT/Claude conectam o MedChina
> como servidor MCP remoto e perguntam sobre seus atendimentos e sobre o acervo de MTC.
> A geração da resposta acontece no modelo do cliente (pago pela assinatura de consumidor
> da profissional); o MedChina só executa recuperação — por isso o consumo via MCP tem
> **peso com desconto** na mesma quota mensal da biblioteca.

## 1. Arquitetura

```
ChatGPT / Claude (cliente MCP)
   │  OAuth 2.1 (PKCE + dynamic client registration)
   ▼
apps/web (Vercel)
   ├─ /.well-known/oauth-authorization-server   (metadata RFC 8414)
   ├─ /.well-known/oauth-protected-resource     (metadata RFC 9728, exigido pelo spec MCP)
   ├─ /oauth/authorize                          (página: sessão Supabase + tela de consentimento)
   ├─ /api/oauth/register                       (RFC 7591)
   ├─ /api/oauth/token                          (code + refresh, PKCE S256 obrigatório)
   └─ /api/mcp                                  (servidor MCP, Streamable HTTP, Bearer token)
        ├─ gates: token → org → org_entitlements → limits->>'mcp_access' → rate limit → quota
        ├─ tools v1 (read-only): consultar_biblioteca_mtc, buscar_paciente,
        │                        resumo_prontuario, proximas_consultas
        └─ efeitos: logAuditEvent + record_library_usage(channel='mcp', weight=W)
```

Um único servidor atende os dois clientes: Claude via "conector personalizado"
(claude.ai/Desktop, planos pagos) e ChatGPT via conectores MCP (modo desenvolvedor) —
o Apps SDK da OpenAI também é MCP, então a publicação no diretório oficial reaproveita
o mesmo servidor (fase 6).

**Tokens opacos, não JWT.** Seguimos o padrão já existente no repo
(`capture-link.ts` / `share-link.ts`): `randomBytes(32).toString("base64url")` no cliente,
`sha256` persistido. Nenhuma dependência `jose`/`jsonwebtoken`. O resource server é o
próprio app, então a validação é um lookup no banco.

**Acesso a dados sem sessão Supabase.** O token OAuth é nosso, não do GoTrue — não há JWT
de RLS. Todas as tools acessam dados via `createServiceClient()` **encapsulado num único
helper** (`apps/web/src/lib/mcp/context.ts`) que resolve `{orgId, userId, scope}` do token
e exige `org_id` explícito em toda query. Nenhuma tool monta query fora desse helper
(ponto único de revisão de segurança).

## 2. Migração `0088_mcp_conectores.sql` — as tabelas

> Numeração conferida: última é `0087_founders_offer.sql`; próximo livre = 0088.
> Espelhar em `supabase/migrations/` conforme o fluxo do `scripts/remote-db-gate.mjs`.

### 2.1 Metering com peso — estende `library_usage` (não cria segundo ledger)

A quota mensal continua UMA só (`plans.limits->>'library_messages'`); o que muda é que
cada linha passa a ter peso. Mensagem in-app = 1.0; consulta MCP de recuperação ≈ 0.1
(configurável, nunca hardcoded).

```sql
alter table public.library_usage
  add column if not exists channel text not null default 'library_chat'
    check (channel in ('library_chat', 'mcp')),
  add column if not exists tool text,
  add column if not exists weight numeric(6,3) not null default 1.0
    check (weight >= 0);

comment on column public.library_usage.channel is
  'Origem do consumo: chat in-app da biblioteca ou tool chamada via conector MCP.';
comment on column public.library_usage.weight is
  'Fração da franquia mensal consumida por esta linha (in-app = 1.0; MCP com desconto).';

create index if not exists library_usage_channel_idx
  on public.library_usage (org_id, channel, created_at desc);
```

Funções a recriar na mesma migração (mesmos guards `security definer` + service_role only
no gravador, como em `0063_library_usage_ledger.sql`):

- `public.org_message_allowance(target_org, target_assistant)` — trocar `count(*)` por
  `coalesce(sum(weight), 0)`; `used` passa a ser numérico (arredondar com 1 casa no retorno).
  Linhas antigas têm `weight = 1.0`, então o histórico não muda.
- `public.record_library_usage(target_org, target_assistant, target_conversation,
  target_user default null, target_channel text default 'library_chat',
  target_tool text default null, target_weight numeric default 1.0)` — parâmetros novos
  com default preservam o call site atual de `apps/web/src/app/api/ai/chat/route.ts:402`.
  `conversation_id` fica `null` no canal MCP (a coluna já é nullable).

### 2.2 OAuth — clientes, códigos, tokens

```sql
-- Clientes registrados dinamicamente (RFC 7591). Sem org: o registro é do app cliente
-- (ChatGPT, Claude), não de um workspace. service_role only.
create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none',
  client_uri text,
  logo_uri text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;
revoke all on table public.oauth_clients from public, anon, authenticated;

-- Códigos de autorização (vida curta, uso único, PKCE obrigatório). service_role only.
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
alter table public.oauth_grants enable row level security;
revoke all on table public.oauth_grants from public, anon, authenticated;

-- Tokens emitidos (access 1h / refresh 30d, rotação a cada refresh, hash sha256).
-- Membros da org podem LER (lista "apps conectados" em /settings); só service_role escreve.
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
create index if not exists oauth_tokens_org_idx on public.oauth_tokens (org_id, created_at desc);
alter table public.oauth_tokens enable row level security;
revoke all on table public.oauth_tokens from public, anon;
grant select on table public.oauth_tokens to authenticated;
revoke insert, update, delete, truncate on table public.oauth_tokens from authenticated;
drop policy if exists oauth_tokens_select_member on public.oauth_tokens;
create policy oauth_tokens_select_member on public.oauth_tokens for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());
```

Versionamento imutável (`enable_row_versioning`) **não** se aplica às tabelas de token
(churn alto, valor probatório baixo — o rastro probatório fica em `audit_events` e
`mcp_requests`). Aplicar apenas em `oauth_clients`:

```sql
select public.enable_row_versioning('public.oauth_clients');
```

### 2.3 Rate limit + trilha por chamada

```sql
-- Uma linha por chamada de tool MCP. Serve de janela de rate limit e de trilha fina
-- (o audit_events guarda o evento clínico; aqui fica o volume). Append-only, service_role only.
create table if not exists public.mcp_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_id uuid references public.oauth_tokens (id) on delete set null,
  tool text not null,
  status text not null default 'ok'
    check (status in ('ok', 'denied_entitlement', 'denied_quota', 'denied_rate', 'denied_consent', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists mcp_requests_window_idx on public.mcp_requests (org_id, created_at desc);
alter table public.mcp_requests enable row level security;
revoke all on table public.mcp_requests from public, anon;
grant select on table public.mcp_requests to authenticated;
revoke insert, update, delete, truncate on table public.mcp_requests from authenticated;
drop policy if exists mcp_requests_select_member on public.mcp_requests;
create policy mcp_requests_select_member on public.mcp_requests for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());
```

Função de checagem (mesma família de `org_message_allowance`):

```sql
-- returns jsonb {allowed, per_minute_used, per_minute_limit, per_hour_used, per_hour_limit}
create or replace function public.mcp_rate_allowance(target_org uuid) returns jsonb ...
-- lê limites de platform_settings 'mcp'; security definer; grant a service_role.
```

### 2.4 Configuração — nunca em código

```sql
-- Pesos e limites operacionais: plataforma (política de preço única, ajustável no admin).
insert into public.platform_settings (key, value)
values ('mcp', jsonb_build_object(
  'enabled', true,
  'weights', jsonb_build_object(
    'consultar_biblioteca_mtc', 0.1,   -- recuperação com embedding (custo ~1-5% do chat)
    'buscar_paciente', 0,              -- determinístico, sem IA
    'resumo_prontuario', 0,            -- determinístico, sem IA
    'proximas_consultas', 0
  ),
  'default_weight', 1.0,               -- tool sem peso declarado paga integral (fail-safe)
  'rate', jsonb_build_object('per_minute', 20, 'per_hour', 200)
))
on conflict (key) do nothing;

-- Disponibilidade por plano: entra em plans.limits (superadmin edita em /admin/billing).
update public.plans set limits = limits || '{"mcp_access": 1}'::jsonb
  where id in ('assistente', 'pro');
update public.plans set limits = limits || '{"mcp_access": 0}'::jsonb
  where id = 'gratuito';
```

Regra de leitura do peso (em TS, no handler): `weights[tool] ?? default_weight` — uma tool
futura que gere conteúdo com modelo NOSSO (ex.: briefing sob demanda) simplesmente não
entra no mapa de descontos e paga 1.0 por padrão.

### 2.5 Termo de conexão (LGPD)

Na tela de consentimento OAuth a profissional aceita um termo versionado — reusa a infra
de `consent_terms`/`consent_acceptances` (0005/0022):

```sql
insert into public.consent_terms (slug, version, title, body, is_active)
values ('external-assistant', 1, 'Conexão com assistente externo', '<texto: os dados
retornados pelas tools trafegam pela conta pessoal de ChatGPT/Claude da profissional,
fora do DPA do MedChina; responsabilidades; revogação em /settings>', true)
on conflict do nothing;
```

Aceite gravado em `consent_acceptances` com `subject_type = 'organization'` no momento
do authorize; revogação carimba `revoked_at` (nunca deleta).

### 2.6 Drizzle

Espelhar as tabelas novas em `packages/db/src/schema/` (novo `oauth.ts` + colunas novas em
`library_usage`). Atenção ao drift já existente no schema TS (`plans.is_addon` e
`subscriptions.past_due_since` faltam no Drizzle) — não copiar o padrão; as tabelas novas
entram completas.

## 3. Contratos das tools (v1 — todas read-only)

Toda resposta de tool termina com o rodapé fixo (linguagem de segurança do PRD §10):
*"Conteúdo de apoio à revisão profissional. Não é diagnóstico nem prescrição; hipóteses
exigem validação da profissional no MedChina."*

| Tool | Entrada | Saída | Gates além dos globais | Peso |
|---|---|---|---|---|
| `consultar_biblioteca_mtc` | `pergunta`, `colecoes?` (subset de `LIBRARY_COLLECTIONS`) | trechos numerados + citações `{title, source, trust_level}` via `searchKnowledge` + `buildKnowledgeContext` | — | 0.1 |
| `buscar_paciente` | `termo` (nome) | lista mínima `{id, nome, ultima_consulta}` | scope `patients:read` | 0 |
| `resumo_prontuario` | `paciente_id` | anamnese estruturada + alertas + últimas consultas finalizadas (montagem determinística; campo ausente = "não informado", **nunca** negação) | scope `patients:read` + `has_active_consent(org, paciente, 'ai-processing')` → senão `denied_consent` com mensagem orientando a coletar consentimento no app | 0 |
| `proximas_consultas` | `periodo?` | agenda resumida | scope `agenda:read` | 0 |

Gates globais em TODA chamada, nesta ordem (cada negação vira linha em `mcp_requests`
com o `status` correspondente e resposta MCP explicativa, nunca silêncio):

1. Token válido, não revogado, não expirado (`sha256` lookup) → atualiza `last_used_at`.
2. `org_entitlements(org)` → `active` e não `suspended`.
3. `limits->>'mcp_access' >= 1`.
4. `mcp_rate_allowance(org)`.
5. Se peso > 0: `org_message_allowance(org, 'biblioteca-mtc')` → se `quota_exhausted`,
   resposta orientando upgrade (espelha o 402 do chat).
6. Executa; depois: `record_library_usage(..., channel='mcp', tool, weight)` (só se peso > 0),
   linha em `mcp_requests`, e `logAuditEvent` (direto de `packages/audit` — `recordAudit`
   não serve aqui pois não há `auth.getUser()`; `actorId` vem do token) com ações
   `mcp.library_query` / `mcp.patient_summary` etc.

Alertas de quota: reusar `usage_alerts` com `meter = 'library_messages'`
(`alertAfterLibraryMessage` em `apps/web/src/lib/usage.ts:129`) — já cobre o pool único.

## 4. OAuth 2.1 — detalhes de implementação

- **Discovery**: `/.well-known/oauth-authorization-server` e
  `/.well-known/oauth-protected-resource` como route handlers estáticos (mesmo padrão dos
  `.well-known` de deep link existentes). `issuer` = `BRAND.siteUrl`.
- **Registro dinâmico** (`POST /api/oauth/register`): aberto (como o spec MCP espera),
  mas com validação estrita de `redirect_uris` (https obrigatório, sem wildcard) e
  rate limit por IP. ChatGPT e Claude se registram sozinhos na primeira conexão.
- **Authorize** (`/oauth/authorize`, página no grupo `(dashboard)` sem shell ou grupo
  próprio): exige sessão Supabase (redirect para sign-in com `next=`); mostra client_name,
  escopos pedidos em linguagem clara, o termo `external-assistant` e o workspace (MVP: a
  única org do usuário via `memberships`). Aceite → grava `consent_acceptances` +
  `oauth_grants` (código com hash, TTL 5 min) → redirect com `code` + `state`.
- **Token** (`POST /api/oauth/token`): `authorization_code` (verifica PKCE S256,
  `redirect_uri` exato, código não consumido/expirado, marca `consumed_at`) e
  `refresh_token` (rotação: revoga o par antigo, emite novo). Sempre via
  `createServiceClient()`.
- **Middleware**: adicionar a `PUBLIC_PREFIXES` (`apps/web/src/middleware.ts:15`):
  `/.well-known/oauth-`, `/api/oauth`, `/api/mcp`. `/oauth/authorize` fica FORA da lista
  (precisa da sessão). Conferir interação com `IMPERSONATION_BLOCKED_PREFIXES`: operador
  impersonando **não** pode autorizar conector (bloquear lá).
- **Revogação**: página `/settings/connections` (slug em inglês, consistente com o
  restante de /settings) lista as conexões da org, botão revogar → server action
  autenticada por cookie carimba `revoked_at` em TODOS os tokens vivos do cliente
  (rotação deixa várias linhas; revogar só a mais nova deixaria um refresh vivo)
  via service client + `recordAudit("mcp.connection_revoked")`.

## 5. Servidor MCP

- Dependências (instalar da RAIZ, regra do workspace): `@modelcontextprotocol/sdk` +
  `mcp-handler` (adapter da Vercel para App Router, transporte Streamable HTTP stateless —
  compatível com serverless; validar na implementação se a versão atual dispensa Redis
  para o modo stateless; se exigir, implementar o transporte direto com o SDK, que suporta
  streamable HTTP sem estado).
- `apps/web/src/app/api/mcp/route.ts` + `apps/web/src/lib/mcp/` (`context.ts` — resolução
  de token e client de dados org-scoped; `tools/*.ts` — um arquivo por tool; `gates.ts`).
- Schemas de entrada com `zod`; descrições das tools em pt-BR, escritas para o MODELO
  cliente (dizem quando usar, o que devolvem e o que não fazem).
- Instruções do servidor (campo `instructions` do MCP) carregam o disclaimer clínico e a
  orientação de sempre citar as fontes numeradas.

## 6. Fases

| Fase | Entrega | Depende de | Esforço |
|---|---|---|---|
| **F1 — Fundação** | Migração 0088 (+ espelho supabase/), Drizzle, funções recriadas; `record_library_usage` do chat in-app passa a mandar `channel='library_chat'` explícito; card de uso da biblioteca mostra fração quando houver consumo MCP | — | 0,5–1 dia |
| **F2 — OAuth AS** | Discovery, register, authorize (tela + termo), token com PKCE + rotação; middleware | F1 | 2–3 dias |
| **F3 — MCP mínimo** | `/api/mcp` + `consultar_biblioteca_mtc` com todos os gates, metering, audit; teste com MCP Inspector + conector no Claude + modo desenvolvedor do ChatGPT | F2 | 1–2 dias |
| **F4 — Prontuário** | `buscar_paciente`, `resumo_prontuario` (gate de consentimento), `proximas_consultas` | F3 | 1–2 dias |
| **F5 — Gestão** | `/settings/conexoes` (listar/revogar), visibilidade no `/admin` (uso MCP por org no console de billing/AI), artigo em `/ajuda` ensinando a conectar | F3 | 1 dia |
| **F6 — Distribuição** | Submissão ao diretório de apps do ChatGPT (Apps SDK, review OpenAI) e ao diretório de conectores da Anthropic; até lá, conexão manual por URL já funciona | F3–F5 | processo externo |

Verificação por fase: `npm run typecheck`, `npm run harness:check`, gate de migração
(`npm run db:migrate:remote` só após revisão), e na F3+ o fluxo real de ponta a ponta com
os dois clientes. Telas novas (`/oauth/authorize`, `/settings/conexoes`) passam pelo
playbook `product-screen` e por `product-verify`.

## 7. Decisões em aberto (defaults propostos, mudam sem refatoração)

1. **Gratuito tem MCP?** Default proposto: não (`mcp_access: 0`) — vira alavanca de
   upgrade; ligar depois é um update em `plans.limits` no admin.
2. **Valores dos pesos** (0.1 para biblioteca; 0 para determinísticas) — chutes honestos
   baseados no custo marginal (embedding + banco ≈ 1–5% de uma mensagem in-app); ajustáveis
   em `platform_settings.mcp` sem deploy.
3. **Tools de prontuário no lançamento?** F4 pode ser adiada e lançar só a biblioteca
   (caso mais seguro em LGPD e de maior valor imediato).
4. **Escopos na tela de authorize**: conceder tudo que o cliente pedir (UX simples) vs.
   checkboxes por escopo. Default: mostrar e conceder o pedido, sem granularidade na v1.

## 8. Estado da implementação e pós-deploy

Implementado em 2026-08-22 (todas as decisões em aberto ficaram nos defaults do §7).
Notas que divergem ou refinam o plano acima:

- **Stack MCP**: `mcp-handler@2.1.1` + `@modelcontextprotocol/server@2.0.0` (v2; o
  `@modelcontextprotocol/sdk` v1 NÃO é usado) + `zod@4` (o server v2 exige schemas com
  Standard JSON Schema — zod 3 não compila). O handler é `(Request) => Response` puro,
  sem Redis, montado direto em `app/api/mcp/route.ts`.
- **Pegadinha do `withMcpAuth`**: `resourceUrl` é usado como BASE literal do
  `resource_metadata` no header 401 — passar `${site}/api/mcp` anunciava um 404.
  Passa-se só a origem (`BRAND.siteUrl`); verificado com smoke test local.
- **`org_message_allowance`/`record_library_usage`** recriadas na 0088 (sum(weight);
  o overload antigo de 4 args foi DROPado para não ambiguar o PostgREST).
- **`oauth_clients`** ganhou policy de select só-superadmin (console `/admin/ai` lê
  nomes); browsers de membros continuam sem acesso.
- **Status extra `denied_scope`** em `mcp_requests`.
- **Espelho supabase/**: gerado por `npm run db:prepare` (0088 vira 0090 no espelho
  por causa dos prefixos duplicados históricos — esperado).
- **Arquivos-chave**: `apps/web/src/lib/oauth/*` (AS), `apps/web/src/lib/mcp/*`
  (gates + tools — superfície de revisão de segurança: todo acesso a dados é
  service-role com filtro explícito de `org_id`), `app/oauth/authorize/*` (consent),
  `app/.well-known/*`, `app/api/oauth/*`, `app/api/mcp/route.ts`,
  `settings/connections/*`, `admin/ai/components/mcp-admin.tsx`.

- **0089 (correção do 1º teste real)**: `org_entitlements` não tinha o ramo
  `service_role` no guard (as irmãs `org_audio_allowance`/`org_message_allowance`
  sempre tiveram) — sob o service client do gate MCP a função levantava
  'not a member' e toda tool morria em "Não foi possível verificar a assinatura".
  A 0089 recria a definição vigente (0054) mudando só o guard.

Checklist pós-deploy (na ordem):

1. `npm run db:plan:remote` (revisar) → `npm run db:migrate:remote` (aplica 0088 + 0089).
2. Conferir `NEXT_PUBLIC_SITE_URL` no ambiente Vercel (o issuer OAuth deriva dele).
3. Publicar o artigo de ajuda (apêndice abaixo) em `/admin/help` — conteúdo de
   ajuda é DB-managed por decisão da 0014, nunca semeado por migração.
4. Testar ponta a ponta: MCP Inspector (`npx @modelcontextprotocol/inspector`),
   conector personalizado no Claude e modo desenvolvedor do ChatGPT.
5. Revisão jurídica do termo `external-assistant` (marcado provisório, como os da 0022).
6. F6: submissão aos diretórios (Apps SDK/OpenAI; conectores Anthropic).

## Apêndice — artigo para /admin/help (pt-BR)

**Categoria sugerida**: Integrações · **Slug**: `conectar-chatgpt-claude` ·
**Título**: Conectar o MedChina ao ChatGPT ou ao Claude

```markdown
Você pode perguntar sobre a biblioteca de MTC e sobre seus atendimentos direto
pelo ChatGPT ou pelo Claude, conectando o MedChina como um "conector" nesses
aplicativos. Disponível nos planos Assistente e Pro.

## Como conectar

1. Copie a URL do conector em **Configurações → Aplicativos conectados** no MedChina.
2. No **ChatGPT**: Configurações → Conectores → Adicionar conector, cole a URL.
   No **Claude**: Configurações → Conectores → Adicionar conector personalizado, cole a URL.
3. O aplicativo vai abrir uma tela do MedChina pedindo para entrar na sua conta e
   autorizar a conexão. Leia o termo, confira as permissões e autorize.

## O que dá para perguntar

- **Biblioteca de MTC**: pontos, fórmulas, padrões de desarmonia, técnicas — as
  respostas vêm com citações das fontes do acervo.
- **Seus atendimentos**: resumo do prontuário de um paciente (apenas pacientes com
  consentimento de processamento por IA ativo) e sua agenda de consultas.

## O que é importante saber

- As consultas pelo aplicativo consomem uma fração da sua franquia mensal da
  biblioteca (bem menor que uma mensagem do chat interno).
- As informações consultadas passam pela sua conta pessoal de ChatGPT/Claude e
  seguem os termos desses serviços — por isso a conexão exige sua autorização
  explícita e pode ser revogada a qualquer momento em **Configurações →
  Aplicativos conectados**.
- Todo conteúdo devolvido é apoio à sua revisão profissional — nunca diagnóstico
  ou prescrição.
```
