# Revisão de licenciamento — acervo da biblioteca clínica

**Data:** 2026-07-19 · **Escopo:** os 459 documentos da coleção global `mtc-fontes-tradicionais` (RAG desde a fase 1; candidatos à exibição navegável na fase 4). Exigida pelo PRD §9.9 ("direitos de uso e licenciamento avaliados antes da ingestão"; "não reproduzir capítulos completos ou trechos extensos protegidos").

> Este documento registra uma avaliação técnica e de produto. Como todo o material de referência do projeto (PRD §26), **não substitui parecer jurídico** — ver "Pendências".

## Metodologia

Auditoria automatizada direta no banco (2026-07-19): contagem e classificação por `metadata.kind`, distribuição de tamanho dos textos, varredura por sinais editoriais (ISBN, editora, avisos de copyright, referências de página) e por nomes de autores consagrados de MTC (com fronteiras de palavra, para evitar falsos positivos como "ross" em "grossa"), e amostragem manual de conteúdo por tipo.

## Achados

| Aspecto | Resultado |
|---|---|
| Composição | 393 pontos de acupuntura · 64 fórmulas chinesas · 2 pontos de Tung |
| Forma | Fichas estruturadas em Markdown (Localização/Puntura, Ações energéticas, Indicações, Padrões, Contraindicações) |
| Tamanho | média 663 caracteres · máx. 2.248 · mín. 218 — **cards de referência, não capítulos** |
| Sinais editoriais | **Zero** (nenhum ISBN, editora, aviso de copyright ou referência de página) |
| Menções a autores | 7 documentos com atribuição honesta do tipo "Segundo G.Maciocia…" — citação, não transcrição |
| Proveniência declarada | Migrado do app anterior da profissional; origem primária **mista/não rastreada** (declaração da operadora, 2026-07-19) |

## Enquadramento (Lei 9.610/98)

- O **conhecimento em si** (localização de pontos, funções, composição de fórmulas — saber tradicional milenar) é fato/método: **não protegido** (art. 8º).
- O risco residual está em (a) **expressão literal** copiada de obra específica — a auditoria não encontrou prosa literária nem sinais de transcrição; o texto é telegráfico/factual — e (b) reprodução da **seleção/organização** de uma compilação alheia (art. 7º, XIII) — não identificável pela auditoria; a proveniência mista mantém esse risco em aberto, baixo porém não nulo.

## Decisão

**A fase 4 (biblioteca navegável) está liberada para desenvolvimento**, condicionada às salvaguardas abaixo — todas valem independentemente da proveniência e reduzem a exposição a nível equivalente ao do uso atual em RAG:

1. **Somente assinante logado** — o acervo nunca é público nem indexável (o sitemap/robots já indexam só o marketing; a rota fica sob o middleware autenticado).
2. **Atribuição visível** em cada documento (campo `source`). Ação conexa: renomear o `source` atual ("Acervo clínico migrado do app anterior (u494950113_app.sql)") para um rótulo humano — ele já aparece nas citações das fases 1–2 e vaza nome interno de banco.
3. **Kill-switch por coleção** — flag `browsable` em `knowledge_collections`; o superadmin pode retirar uma coleção da navegação imediatamente sem afetar o RAG.
4. **Aviso de finalidade** na tela: material de referência para estudo profissional; não substitui avaliação clínica (mesma linguagem de segurança do produto).
5. Novas ingestões continuam obrigadas à avaliação prévia (PRD §9.9) — esta revisão cobre apenas o acervo atual.

## Pendências

- [ ] **Parecer jurídico formal antes do lançamento público** da biblioteca navegável (escopo: exibição integral do acervo a assinantes; proveniência mista declarada).
- [ ] Renomear `source` dos 459 documentos (junto com a fase 4).
- [ ] Se no futuro a profissional identificar entradas transcritas de obra específica: reescrever ou remover via `/admin/knowledge` (o kill-switch cobre o intervalo).
