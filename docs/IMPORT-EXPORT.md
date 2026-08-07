# Importação e exportação de dados

Plano de implementação para migração de outro sistema (entrada) e portabilidade
(saída).

**Estado: fases A e B entregues** — schema e desfazer em
[0076_data_import.sql](../packages/db/migrations/0076_data_import.sql), engine e
gravação transacional em [0077_import_commit.sql](../packages/db/migrations/0077_import_commit.sql)
+ [lib/import/](../apps/web/src/lib/import/), com o comportamento fixado em
[0016](../packages/db/tests/0016_data_import.test.sql)/[0017](../packages/db/tests/0017_import_commit.test.sql)
e nos testes vitest ao lado dos módulos. Falta a interface (Fase C) — hoje nada
disso é alcançável pela profissional. A outra superfície existente é a página pública
[/migracao](../apps/web/src/app/(marketing)/migracao/page.tsx), que promete
avaliação caso a caso pelo suporte — a cópia é honesta ("a migração não é
automática"), então não há promessa a resgatar, apenas produto a construir.

Referências do PRD: §9.10 (busca, exportação e suporte), §14.4/§14.5
(minimização e eliminação), §5 (planos), linha 429 (leitura e exportação não
desaparecem por falha de pagamento).

---

## 0. Decisão registrada: histórico legado NÃO é estruturado por IA

Foi avaliada e **descartada** a ideia de usar IA para transformar texto livre de
prontuários antigos em anamnese estruturada (blocos/campos de
[anamnesis.ts](../apps/web/src/lib/anamnesis.ts)).

**Motivo**: o sistema não deve se comprometer com informação que ele não
produziu. Preencher um campo clínico a partir de um registro feito em outro
software cria o risco de afirmar como dado da paciente algo que foi inferido de
um texto de terceiro — exatamente o que os invariantes do produto existem para
impedir. Um registro legado não tem proveniência por campo (não há trecho de
áudio, não há timestamp, não há autoria verificável), e sem proveniência não há
revisão possível: a profissional veria um campo preenchido sem poder conferir de
onde veio.

Consequência prática, que vale para todas as fases abaixo: **conteúdo importado
nunca vira linha em `anamnesis_answers`**. Ele entra como texto íntegro,
identificado como registro de outro sistema, legível e buscável — nunca como
resposta estruturada, nunca com `answer_source`.

Isto não é um item de backlog. É uma restrição de projeto.

---

## 1. Invariantes que a implementação não pode violar

1. **Importado nunca vira anamnese.** Sem `anamnesis_answers`, sem `source`
   clínico. Ver §0.
2. **Importado é sempre identificável.** Toda entidade criada por importação
   carrega o lote de origem e é rotulada na UI ("importado de <sistema> em
   <data>"). Um dado que não sabemos ter sido conferido não pode se parecer com
   um dado que ela mesma escreveu.
3. **Célula vazia é ausência, não negativa** (PRD §10.5). Nunca gravar string
   vazia, nunca gravar "não". Coluna vazia = campo não preenchido.
4. **Dry-run obrigatório.** Nada é escrito antes de a profissional ver o que
   será criado, atualizado, ignorado e recusado.
5. **Idempotência.** Reenviar a mesma planilha atualiza; nunca duplica.
6. **Importação não passa por impersonation.** `patients` está na cerca de
   escrita de [0057_impersonation.sql](../packages/db/migrations/0057_impersonation.sql)
   — criar paciente nunca é trabalho do suporte agindo como ela. A migração
   assistida tem caminho próprio (§6), com service role e autorização registrada.
7. **Consentimento nunca é importado.** Nenhum consentimento de gravação, IA ou
   imagem vem de planilha. Paciente importada começa sem consentimento e o
   gatilho de `recordings` continua barrando captura — comportamento correto,
   nada a fazer.
8. **Exportação é livre em todos os planos**, inclusive Gratuito e conta com
   pagamento em atraso (PRD linha 429). Prometer portabilidade e cobrar por ela
   seria incoerente.

---

## 2. Escopo por tipo de dado

| Dado | Entra? | Como |
| --- | --- | --- |
| **Cadastro de pacientes** | Sim — prioridade 1 | Direto em `patients` (nome, nascimento, documento, e-mail, telefone, observações, alertas) |
| **Histórico de atendimentos** | Sim — prioridade 2 | `consultations` já `finalized`, com o texto legado íntegro em coluna própria |
| **Agenda futura** | Sim — prioridade 3 | `consultations` com `status = 'scheduled'` e `scheduled_for` (não existe tabela de agenda — ver [0027_agenda.sql](../packages/db/migrations/0027_agenda.sql) e [0028](../packages/db/migrations/0028_continuity_agenda_patients.sql)) |
| **Anexos/PDFs antigos** | Opcional, fase tardia | `consultation_attachments` com `kind = 'document'` |
| **Áudios** | Não | Sem consentimento válido e sem valor clínico retroativo |
| **Documentos assinados de terceiros** | Não como documento emitido | Nossos `documents` têm hash e QR verificável; um PDF alheio entra como anexo, jamais como documento nosso |
| **Consentimentos** | Não | §1.7 |

Só a prioridade 1 já resolve a maior parte da dor de troca de sistema: o que
trava a adoção é redigitar a base de pacientes.

---

## 3. Fase A — schema (`0076_data_import.sql`) — **implementada**

Duas coisas mudaram em relação ao desenho abaixo, ambas descobertas ao rodar os
testes: `consultations` também ganhou `external_ref` (histórico reimportado
precisa da mesma idempotência do cadastro), e os `revoke` tiveram de nomear
`authenticated`/`anon` — o padrão `revoke all ... from public` da casa não tira
nada, porque o baseline de default privileges do Supabase já concedeu ALL a
esses papéis (ver `packages/db/README.md`).


### Tabelas novas

**`import_batches`** — um lote é a unidade de rastreio e de desfazer.

```
id, org_id, kind ('patients' | 'history' | 'schedule'),
source_system text,               -- o que ela declarou estar deixando
status ('parsing'|'preview'|'importing'|'completed'|'failed'|'reverted'),
file_path text,                   -- bucket privado 'imports'
file_checksum text,
mapping jsonb,                    -- coluna da planilha -> campo do sistema
counts jsonb,                     -- {created, updated, skipped, failed}
error text,
created_by, created_at, completed_at, reverted_at
```

**`import_rows`** — staging das linhas já parseadas e normalizadas.

```
id, batch_id, org_id, row_number,
raw jsonb,                        -- a linha como veio
normalized jsonb,                 -- após parse/validação
action ('create'|'update'|'skip'|'error'),
target_type text, target_id uuid, -- preenchido no commit
error_code text, error_message text
```

Esta tabela é o que torna o dry-run honesto: **preview e commit leem as MESMAS
linhas já parseadas**. Se o commit reprocessasse o arquivo, ela estaria
aprovando um resultado e executando outro.

### Colunas novas

- `patients.external_ref text` + `unique (org_id, external_ref) where external_ref is not null` — chave de idempotência (o ID do sistema antigo, quando existir).
- `patients.import_batch_id uuid references import_batches on delete set null`.
- `consultations.import_batch_id uuid` + `consultations.legacy_body text` + `consultations.legacy_source text`.

Sobre `legacy_body`: **não reaproveitar `consultations.summary`**. `summary` é o
resumo clínico que ela escreve ou revisa; misturar texto de outro sistema ali
apaga a fronteira do §1.2. Coluna própria, com `check` garantindo que só existe
quando `import_batch_id` não é nulo, e renderizada com rótulo de origem.

Uma consulta legada é inserida **já com `status = 'finalized'`** (o gatilho de
congelamento de [0020_clinical.sql](../packages/db/migrations/0020_clinical.sql)
age em UPDATE/DELETE, não em INSERT) — registro antigo é histórico, não rascunho
editável.

### RLS, cerca e versionamento

- `import_batches` / `import_rows`: leitura e escrita por `is_org_member(org_id)`; sem política de UPDATE em `import_rows` para linhas de lote concluído.
- Adicionar **as duas tabelas à cerca de impersonation** (mesmo laço de 0057): importar cria pacientes, e isso não é ato do suporte agindo como ela.
- `select public.enable_row_versioning('public.import_batches')` — o lote é evidência de procedência de dado clínico.

### Storage

Bucket privado `imports`, caminho `<org_id>/<batch_id>/<arquivo>`. Políticas
espelhando o padrão de [0013_avatars.sql](../packages/db/migrations/0013_avatars.sql),
porém **privado** e por org, não por usuário.

**Retenção curta**: a planilha original é dado clínico em texto puro. Apagar via
job depois da janela de reversão (padrão 30 dias, configurável em
`platform_settings`), e auditar todo download.

### RPC de reversão

`revert_import_batch(batch uuid)` — apaga o que o lote criou **somente se nada
aconteceu depois**: paciente sem consulta criada após a importação, sem
consentimento, sem documento, `updated_at = created_at`. Qualquer coisa fora
disso e a função **recusa nomeando o que bloqueia**. Apagar uma paciente cascata
nas consultas dela; um "desfazer" permissivo destruiria trabalho real.

---

## 4. Fase B — engine (`apps/web/src/lib/import/`) — **implementada**

Entregue como módulos puros (bytes entram, linhas preparadas saem) mais o
gravador transacional em [0077_import_commit.sql](../packages/db/migrations/0077_import_commit.sql).
Três desvios do desenho abaixo, todos deliberados:

- **`validate.ts` não existe**: a validação por linha e a detecção de duplicata
  são a mesma passada que monta o preview, e separá-las obrigaria a percorrer
  as linhas duas vezes com as mesmas regras. Tudo vive em `preview.ts`.
- **O commit é um RPC, não um laço em TS**: só o banco garante que uma
  importação pela metade não existe. Isso também dispensou a fila do Inngest —
  são poucos milissegundos numa chamada só. Lotes de dezenas de milhares de
  linhas (que nenhum consultório tem) precisariam de commit em blocos, e aí a
  atomicidade teria de ser repensada.
- **Sobrenome em coluna separada é suportado** (`Nome` + `Sobrenome`), porque é
  como metade dos sistemas exporta; mas um sobrenome sozinho **não** salva uma
  linha sem nome — "da Silva" não é um prontuário que alguém reencontra.

Regra do commit que o schema força e a UI só reflete: **atualizar preenche
lacunas, nunca sobrescreve**. Reenviar a exportação do mês passado não pode
reverter em silêncio as correções que ela digitou desde então.


Fica em `apps/web/src/lib/` junto de `clinical-pipeline.ts` e `anamnesis.ts`:
é lógica clínica desta aplicação, não infraestrutura reutilizável entre apps
(o mobile não importa nada). Se um dia o admin precisar da mesma engine, ela já
está no mesmo app.

- **`parse.ts`** — CSV primeiro, via `papaparse`. Detecção de delimitador (`;` é
  o padrão de exportação BR) e de encoding: sistemas brasileiros exportam
  **latin-1** com frequência, e o sintoma de errar isso é nome de paciente com
  mojibake gravado no prontuário. XLSX numa segunda rodada, com `exceljs`
  (preferível ao SheetJS por manutenção/histórico de segurança).
- **`mapping.ts`** — heurística de cabeçalho para pré-mapear (nome/paciente,
  nascimento/data nasc/dob, cpf/documento, telefone/celular/whatsapp, email,
  obs/observações). Sempre confirmável e sobrescrevível pela profissional.
- **`normalize.ts`** — reaproveita [packages/fields](../packages/fields/src/index.ts)
  (`onlyDigits`, `isValidCpf`, `isValidPhoneBr`) — persistir dígitos, nunca
  máscara. **Data é a maior armadilha**: `03/04/1985` é ambíguo. Resolver por
  coluna, varrendo todos os valores em busca de um dia > 12; permanecendo
  ambíguo, **perguntar** — nunca chutar. Uma importação que troca dia por mês em
  12 linhas é indetectável depois.
- **`validate.ts`** — erros e avisos por linha; duplicatas dentro do arquivo;
  duplicatas contra a base existente na ordem `external_ref` → documento →
  nome + data de nascimento (apenas as duas primeiras geram `update`
  automático; homônimo com mesma data vira aviso para decisão humana).
- **`commit.ts`** — escrita em blocos dentro de transação, marcando `import_rows`
  com o `target_id` produzido. Lotes acima de ~500 linhas vão para Inngest com
  o fallback inline do padrão do repo (`sendEvent` nunca lança).

---

## 5. Fase C — UI (carregar a skill `product-screen` antes)

Entrada em [/pacientes](../apps/web/src/app/(dashboard)/pacientes/page.tsx):
ação secundária "Importar de outro sistema". A primária continua "Novo paciente"
— é o primeiro passo de ativação e não pode perder o palco.

Assistente em 5 passos:

1. **Arquivo + origem** — upload e "de qual sistema você está vindo?" (campo
   livre; alimenta `source_system` e, agregado, diz para onde vale construir
   suporte dedicado depois).
2. **Mapeamento** — colunas detectadas ao lado dos campos do sistema, com
   preview de 5 linhas reais. Coluna não mapeada é descartada explicitamente,
   nunca silenciosamente.
3. **Conferência** — quantos serão criados, atualizados, ignorados, recusados;
   erros listados com número da linha e download de um CSV só com as linhas
   problemáticas, para corrigir e reenviar.
4. **Execução** — progresso real; lote grande continua em background e ela pode
   sair da tela.
5. **Resultado** — link para os pacientes importados e botão "Desfazer
   importação" enquanto a janela permitir (§3).

Contrato do product lint: erro nunca é renderizado como vazio; i18n no namespace
`product`, nos 5 locales; sem valores de tema crus; nomes acessíveis em
controles de ícone.

Na ficha da paciente e na consulta, o conteúdo legado aparece em bloco próprio
com rótulo de origem — nunca dentro dos blocos de anamnese.

---

## 6. Fase D — migração assistida pelo suporte

A mesma engine, operada por superadmin a partir de `/admin/organizations`, com
service role. **Nunca por impersonation** (§1.6 — `patients` é fenced e afrouxar
isso abriria exatamente o buraco que a cerca fecha).

Exige justificativa e referência da autorização da titular da conta, registra
`import.assisted` em `audit_events`, e notifica a profissional no sino. É este
caminho — trabalho humano — que a página /migracao já descreve e que pode ser
cobrado como serviço avulso.

---

## 7. Fase E — exportação (a contrapartida obrigatória)

Metade do mesmo trabalho, porque o schema é o mesmo, e fecha a lacuna do PRD
§9.10.

- **Por paciente**: PDF legível + JSON estruturado (ficha, consultas, adendos,
  planos validados, metadados dos documentos emitidos).
- **Conta inteira**: ZIP gerado por job, link assinado com expiração curta,
  download auditado.
- **Disponível em todos os planos**, inclusive Gratuito, conta em atraso e
  assinatura cancelada. Só o que consome IA depende de plano; ler e levar embora
  os próprios dados, não.

---

## 8. Planos e limites

- **Importar é grátis em todos os planos.** É mecanismo de aquisição, não
  recurso premium: é o que remove o custo de trocar de sistema. O plano Gratuito
  já oferece pacientes e prontuários manuais ilimitados — cobrar para colar a
  mesma planilha que ela pode digitar de graça contradiz o posicionamento e
  desgasta mais do que arrecada.
- **Teto por lote configurável**, nunca constante no código: `plans.limits.import_rows`
  (ausente = ilimitado). Sugestão inicial: 200 linhas/lote no Gratuito,
  ilimitado nos pagos. Segura custo sem parecer sequestro de dados.
- **Migração assistida (§6) é serviço pago** — é hora de gente.
- **Exportação sem limite em qualquer plano** (§1.8).

---

## 9. Telemetria

Eventos: `import.started`, `import.previewed`, `import.committed`,
`import.reverted`, `export.requested`.

Adicionar evento exige estender **as duas** allowlists de `product_events`
(check do nome **e** allowlist de propriedades do RPC, em
[0048_library_product_events.sql](../packages/db/migrations/0048_library_product_events.sql)).
Nenhuma propriedade pode carregar conteúdo clínico ou UUID de paciente —
apenas `row_count` em faixas, `kind` e `source_system`.

E `trackProductEvent` precisa terminar o builder do PostgREST (`.then()`):
um `void supabase.rpc(...)` solto nunca dispara a requisição.

---

## 10. Ordem de execução

| # | Entrega | Pronto quando |
| --- | --- | --- |
| 1 | ✅ Migração `0076_data_import.sql` | **Feito.** Tabelas, colunas, RLS, cerca de impersonation, bucket e `revert_import_batch` aplicados; reversão recusa lote com trabalho posterior (28 asserções em `packages/db/tests/0016_data_import.test.sql`) |
| 2 | ✅ Engine de pacientes (parse → normalize → preview → commit) | **Feito.** `apps/web/src/lib/import/` + `0077_import_commit.sql`; planilha BR (`;`, latin-1, datas ambíguas, nome dividido em duas colunas) importa sem corromper nome nem data — 39 testes vitest + 21 pgTAP |
| 3 | Assistente de importação de pacientes | Fluxo completo com dry-run, erros por linha e desfazer |
| 4 | Exportação por paciente | PDF + JSON, disponível no Gratuito |
| 5 | Histórico legado como texto íntegro | Consulta importada aparece rotulada, congelada, fora da anamnese |
| 6 | Exportação da conta | ZIP por job, link assinado, auditado |
| 7 | Agenda futura | Consultas `scheduled` importadas sem conflito de horário |
| 8 | Migração assistida no admin | Service role, autorização registrada, auditada, notificada |

---

## 11. Riscos conhecidos

- **Data ambígua** (`03/04/1985`) — resolver por coluna ou perguntar; nunca chutar.
- **Encoding latin-1** — mojibake em nome de paciente é permanente e constrangedor.
- **Duplicatas** — homônimo com mesma data de nascimento existe; só `external_ref` e documento autorizam merge automático.
- **Desfazer destrutivo** — reversão precisa recusar, não avisar.
- **A planilha é dado clínico** — bucket privado, retenção curta, download auditado, apagada com o lote.
- **Expectativa de completude** — a UI precisa dizer, no resultado, o que NÃO foi importado (áudios, consentimentos, documentos assinados de terceiros). Silêncio aqui vira reclamação depois.
