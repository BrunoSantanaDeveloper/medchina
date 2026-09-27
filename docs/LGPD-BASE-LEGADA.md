# Base legal da base antiga (~500 contatos) — rascunho para revisão jurídica

**Status:** RASCUNHO · **Criado em:** 2026-09-26 · **Exigido por:** `docs/FUNIL.md` (Fase 0 item 6,
Riscos 1, portão de largada) e `docs/PAGINA-EVENTO.md` §9.1

**Nenhum contato com esta base sai antes de este documento estar preenchido, revisado por quem faz a
assessoria jurídica e assinado pela controladora.** Tudo que está marcado `[a preencher]` depende de
informação que o repositório não tem. Não preencha com suposição: um documento de base legal com fato
inventado é pior do que nenhum, porque é o que será mostrado se alguém questionar o contato.

---

## 1. Identificação

| Campo | Valor |
|---|---|
| Controladora | MedChina Gestão e Prontuários · CNPJ 38.504.491/0001-80 · Goiânia (GO) |
| Contato para titulares | contato@medchinaprontuarios.com.br |
| Responsável pela avaliação | [a preencher] |
| Revisão jurídica | [a preencher: nome, data] |
| Data da assinatura | [a preencher] |

## 2. A base

O que o repositório registra (`docs/FUNIL.md`, auditoria de 2026-08-09):

- cerca de 500 cadastros da **versão anterior** do MedChina;
- no máximo 20 chegaram a pagar, e a versão anterior encerrou com 5 pagantes;
- a base está **fora do banco atual** — não foi migrada, e o contato previsto é externo (WhatsApp
  manual e ferramenta de e-mail externa; o produto atual não tem disparo em massa).

O que falta saber, e decide a base legal:

| Pergunta | Resposta |
|---|---|
| Como cada contato entrou na base (cadastro no produto, formulário, congresso de 2020, compra)? | [a preencher, por origem] |
| Que texto a pessoa aceitou ao se cadastrar (termos, política, caixa de comunicação)? Existe cópia datada? | [a preencher] |
| Quais dados existem por contato (nome, e-mail, telefone, profissão, outros)? | [a preencher] |
| Algum dado de saúde ou de paciente está nessa base? | [a preencher — se sim, esse dado **não** entra em nenhum contato comercial] |
| Quando foi o último contato com cada grupo? Houve pedidos de exclusão ou de parar de receber? | [a preencher] |
| Onde a base está guardada hoje, e quem tem acesso? | [a preencher] |

## 3. Hipótese legal

Duas possibilidades (LGPD, art. 7º):

- **Consentimento anterior (art. 7º, I)** — só vale se houver prova de que a pessoa aceitou receber
  comunicação do MedChina, com o texto e a data. Consentimento genérico ou presumido não serve.
- **Legítimo interesse (art. 7º, IX, e art. 10)** — exige a avaliação da seção 4, transparência com o
  titular e opt-out fácil. É a hipótese provável para quem se cadastrou no produto anterior sem caixa
  de comunicação.

Escolha: [a preencher, por grupo de origem, depois da seção 2]

## 4. Avaliação de legítimo interesse (LIA)

Estrutura em três etapas, como no guia da ANPD sobre legítimo interesse.

### 4.1 Finalidade

- Finalidade concreta: convidar ex-usuárias da versão anterior para conhecer a nova versão e para o
  ao vivo sobre a Lei 15.345. [confirmar]
- O interesse é legítimo e específico: a relação anterior foi com o mesmo produto, da mesma
  controladora, para a mesma atividade profissional. [confirmar com a seção 2]
- A finalidade **não** inclui: vender a lista, repassar a terceiros, montar público de anúncio com
  ela, nem contato sobre assunto alheio ao MedChina.

### 4.2 Necessidade

- Dados usados: só nome e o canal de contato (e-mail ou WhatsApp). Nada além disso é necessário para
  um convite. [confirmar]
- Alternativa menos invasiva considerada: [a preencher — por exemplo, um contato único de reapresentação
  em vez de uma sequência]

### 4.3 Balanceamento e salvaguardas

- **Expectativa da titular:** quem usou o produto anterior pode razoavelmente esperar ser avisada de
  uma nova versão? [avaliar pelo tempo desde o último contato e pelo que ela aceitou]
- **Impacto:** baixo se o contato for único, identificado e com saída fácil; alto se virar sequência
  insistente. A base "já foi queimada uma vez" (FUNIL), o que pesa contra a expectativa.
- **Salvaguardas obrigatórias:**
  - toda mensagem diz quem escreve, de onde veio o contato e como sair ("responda SAIR" /
    link de descadastro);
  - quem pedir para sair nunca mais é contatado, e o pedido é registrado;
  - número de contatos por pessoa limitado a [a preencher];
  - a lista antiga **nunca** é importada na tabela `leads` do produto: quem responder e se inscrever
    no evento vira lead novo, com o consentimento novo (`docs/PAGINA-EVENTO.md` §9.1);
  - a lista antiga **nunca** sobe como público de anúncio.

Conclusão: [a preencher — o interesse legítimo prevalece? para quais grupos?]

## 5. Transparência e direitos

- A política de privacidade passa a mencionar o contato com ex-usuárias da versão anterior e a
  hipótese legal (`privacy-*`, seis idiomas, junto com a atualização do `docs/PAGINA-EVENTO.md` §9).
- Direitos da titular (art. 18): acesso, correção, eliminação e oposição, pelo contato da seção 1.
  Prazo de resposta: [a preencher].

## 6. Retenção

- Depois do contato de reapresentação, o que acontece com a lista antiga? [a preencher — por exemplo:
  eliminar quem não respondeu, em data definida]
- Quem se inscreveu passa a existir só como lead novo; o registro antigo dela pode ser eliminado.

## 7. Operadores

- Ferramenta de e-mail externa usada no disparo: [a preencher], com contrato de operador (DPA).
- Número de WhatsApp usado: [a preencher]. Contato manual, um por vez, sem ferramenta de disparo
  (a mesma regra do §0.2 da `PAGINA-EVENTO.md`).

## 8. Assinatura

Avaliação aprovada por: [nome, cargo] · Data: [a preencher]

Revisão jurídica: [nome, OAB] · Data: [a preencher]
