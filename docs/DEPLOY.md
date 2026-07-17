# Deploy — Vercel via GitHub Actions

O `apps/web` é publicado na Vercel **exclusivamente pelo pipeline do GitHub**
(`.github/workflows/deploy.yml`), usando a Vercel CLI com token. O projeto na
Vercel fica **sem conexão Git** — a integração Git da Vercel nunca é ligada
(ela força um vínculo de conta GitHub e conflita quando há várias contas GitHub
na mesma máquina/organização).

- `push` na `main` (ou execução manual do workflow) → deploy de **produção**
- `pull_request` → deploy de **preview** (URL no summary da execução)

O workflow roda `vercel deploy` (com `--prod` na produção): o pipeline **envia
o código-fonte e a Vercel compila na nuvem**. Isso é deliberado — o fluxo
alternativo (`vercel build --prebuilt`, compilando no runner) isola o build no
Root Directory (`apps/web`) e quebra os symlinks de workspace para
`../../packages/*` (`Module not found: Can't resolve '@flyee/content'`). O build
da nuvem resolve os pacotes `@flyee/*` nativamente. Continua tudo por token, sem
a integração Git da Vercel.

## Setup único

### 1. Criar/vincular o projeto na Vercel (local, uma vez)

Na raiz do repositório (o login é na conta **Vercel**, independente das contas
GitHub da máquina):

```bash
npx vercel login
npx vercel link
```

No `link`, escolha o escopo (team/conta) e crie o projeto novo (ex.:
`medchina`). Isso gera `.vercel/project.json` (gitignored) com o `orgId` e o
`projectId` — são os valores dos secrets do passo 4.

### 2. Configurar o projeto no dashboard da Vercel

Em **Settings → General**:

- **Root Directory**: `apps/web` (obrigatório — monorepo npm workspaces; a
  Vercel detecta os workspaces e instala a partir da raiz do repo)
- **Include files outside of the Root Directory in the Build Step**: **LIGADO**
  (checkbox logo abaixo do Root Directory). Sem isso, o build da nuvem fica
  confinado a `apps/web` e os pacotes compartilhados (`@flyee/content`,
  `@flyee/design-tokens`, etc., que vivem em `../../packages/*`) não resolvem —
  o build quebra com `Module not found: Can't resolve '@flyee/content'`.
- **Framework Preset**: Next.js.
- **Node.js Version**: 22.x (ou 24.x — o build da nuvem usa a versão do projeto).
- **Build/Install/Output Command (Override)**: deixe os toggles **DESLIGADOS**.
  O `apps/web/vercel.json` (versionado) já define o install e o build — ele tem
  precedência e é a fonte de verdade (ver abaixo). Não duplique no dashboard.

> O deploy é build na nuvem: essa config vale no ato do build. Ligue o checkbox
> no dashboard e reexecute o workflow.

Em **Settings → Git**: **não conectar** nenhum repositório. É isso que evita o
conflito de contas — todo deploy entra pela CLI do pipeline.

#### `apps/web/vercel.json` — duas correções que NÃO podem sumir

```json
{ "installCommand": "cd ../.. && npm ci", "buildCommand": "next build" }
```

1. **`installCommand: "cd ../.. && npm ci"`** — o install padrão da Vercel
   (rodado dentro de `apps/web`) NÃO cria os symlinks de workspace
   `node_modules/@flyee/*`, mesmo com o checkbox de "include files outside"
   ligado. Resultado: `Module not found: Can't resolve '@flyee/content'`
   (compila localmente porque o `node_modules` local já tem os links). Forçar
   `npm ci` na RAIZ do monorepo instala com os workspaces linkados corretamente.
2. Memória do build (ver `apps/web/next.config.mjs`): o container de build (8 GB)
   dava **OOM/SIGKILL** na fase "Linting and checking validity of types". O
   `next.config.mjs` desliga lint+typecheck no `next build`
   (`eslint.ignoreDuringBuilds` + `typescript.ignoreBuildErrors` — ambos já são
   cobertos pelas etapas dedicadas do CI) e limita a paralelização
   (`experimental.cpus: 1` + `webpackMemoryOptimizations`). Se o build voltar a
   dar OOM ao crescer, o passo seguinte é aumentar o build machine (plano Pro).

### 3. Variáveis de ambiente (Settings → Environment Variables)

Cadastre em **Production** (e repita em **Preview** as que quiser testar em
PRs — no mínimo as de Supabase e a licença MUI). Referência completa:
`apps/web/.env.example`.

Obrigatórias para produção:

| Variável | Observação |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `DATABASE_URL` | connection string **pooled** (porta 6543) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only (admin, backups, billing público) |
| `NEXT_PUBLIC_MUI_X_LICENSE_KEY` | licença MUI X Premium |
| `NEXT_PUBLIC_SITE_URL` | domínio canônico, sem barra final (sitemap/robots/OG/JSON-LD caem para `http://localhost:3000` sem ela) |
| `NEXT_PUBLIC_CDN_URL` | `/assets/cdn/` (igual ao `.env.example`) |

Núcleo do produto (IA/transcrição) e operação:

| Variável | Observação |
| --- | --- |
| `GEMINI_API_KEY` | transcrição/diarização + embeddings RAG — coração do produto |
| `ANTHROPIC_API_KEY` | assistentes/raciocínio clínico (provider Anthropic) |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | jobs em background (sem elas tudo cai para processamento inline) |
| `RESEND_API_KEY` / `EMAIL_FROM` | e-mail transacional (convites caem para link copiável sem elas) |
| `CONTACT_FORM_TO` | destino do formulário de contato |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | billing Stripe |
| `ASAAS_API_KEY` / `ASAAS_WEBHOOK_TOKEN` / `ASAAS_BASE_URL` | billing Asaas (produção: `https://api.asaas.com/v3`) |
| `BACKUP_RETENTION_DAYS` | opcional (default 30) |

### 4. Token e secrets do GitHub

1. Vercel → **Account Settings → Tokens** → criar um token com escopo no
   team/conta do projeto.
2. GitHub → repositório → **Settings → Secrets and variables → Actions**:
   - `VERCEL_TOKEN` — o token criado
   - `VERCEL_ORG_ID` — `orgId` do `.vercel/project.json`
   - `VERCEL_PROJECT_ID` — `projectId` do `.vercel/project.json`

### 5. Domínio

**Settings → Domains** → adicionar o domínio de produção e apontar o DNS.
`NEXT_PUBLIC_SITE_URL` deve ser exatamente esse domínio (com `https://`, sem
barra final).

## O que o deploy NÃO faz

- **Migrações de banco**: o pipeline não toca no Postgres. Quando houver
  migração nova em `packages/db/migrations`, rode antes do merge:
  `npm run db:plan:remote` (dry-run) e `npm run db:gate:remote`
  (aplica + testa) — ver `scripts/remote-db-gate.mjs`.
- **Storage/RLS/seeds**: idem — tudo entra pelas migrações.

## Pós-deploy (primeira vez)

- **Inngest**: no dashboard do Inngest, sincronizar o app apontando para
  `https://<domínio>/api/inngest` (depois de setar as duas chaves).
- **Webhooks de billing**: apontar Stripe para
  `https://<domínio>/api/webhooks/stripe` e Asaas para
  `https://<domínio>/api/webhooks/asaas`.
- **Supabase Auth**: em Authentication → URL Configuration, definir o Site URL
  para o domínio de produção e adicionar as redirect URLs de auth.
- Smoke test: home pública, `/auth/sign-in`, criar workspace, `/inicio`.

## Troubleshooting

- `Module not found: Can't resolve '@flyee/content'` (ou qualquer `@flyee/*`)
  no build → o checkbox **"Include files outside of the Root Directory in the
  Build Step"** está desligado. Ligue-o (Settings → Build and Deployment →
  Root Directory) e reexecute o workflow. O código resolve os pacotes por
  symlink de workspace (`node_modules/@flyee/* → packages/*`); confinar o build
  a `apps/web` quebra esses symlinks.
- `husky: not found` / `npm install exited with 127` → já corrigido: o script
  `prepare` da raiz é `husky || true`, tolerante à ausência do husky no CI.
- `Project not found` / erro de escopo no `vercel deploy` →
  `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` não batem com o token (token criado em
  outro team). Recrie o token no escopo certo.
- Build da nuvem falha por variável faltando → cadastre-a no ambiente
  correspondente da Vercel (o build de PR usa **Preview**, o de `main`/manual
  usa **Production**).
- Deploy de produção "preso" → o job usa concurrency `vercel-production` sem
  cancelamento: deploys enfileiram na ordem dos pushes.
