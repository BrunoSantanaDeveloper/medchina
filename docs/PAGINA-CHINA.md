# Página `/china` — especificação de implementação

**Status:** pronta para construir · **Escrita em:** 2026-09-26 · **Revisada em:** 2026-09-26 após
auditoria de viabilidade contra o código (lint simulado, fatos verificados na publicação original da
lei e nas fontes da UFG, vereditos registrados no histórico da sessão)

A página de autoridade do congresso de Xinjiang. Ela **não vende**: convence e entrega o clique
para a `/assinar`, que já é a máquina de conversão do repositório (plano, preço e prazo vindos de
`platform_settings.campaign_offer`, herói variável por `utm_content`, deadline que o checkout
respeita). Construir um segundo caminho de venda criaria duas fontes de verdade sobre preço — o
mesmo vazamento que a `/assinar` já corrigiu uma vez.

---

## 0. Decisões fechadas (não reabrir durante a implementação)

| Decisão | Escolha |
|---|---|
| Rota | `src/app/(autoridade)/china/page.tsx` |
| Grupo de rotas | **`(autoridade)`, route group irmão com layout próprio** — nem `(marketing)` nem `(funil)`. Motivo em §0.2 |
| Design system | **Landing DS** (`clinical-source-home.css`): classes do DS, ícones Phosphor **diretos** (`@phosphor-icons/react/dist/ssr`, `duotone`/`fill`), cores pelas custom properties do DS (`--jade`, `--ink`, `--paper`…), copy pt-BR no arquivo — exatamente como `/assinar` e `/fundadores` (`docs/DESIGN.md`, "The Landing DS") |
| Cabeçalho | O `.site-header` da DS **com navegação real**, extraído da home para `components/marketing/home-header.tsx`: logo linkando para `/`, links para `/como-funciona`, `/recursos`, `/planos`, `/seguranca`, "Entrar", e o CTA da página. **Sem** "Criar conta grátis" e **sem** switcher de idioma. Rodapé idem (`home-footer.tsx`) |
| Indexação | Indexada, no sitemap, canonical próprio — o oposto da `/assinar`. Indexação é decisão de `metadata` + `sitemap.ts` + `PUBLIC_PREFIXES`; não depende do grupo de rotas |
| Idioma | pt-BR direto, como `/fundadores` e `/assinar`. Consequência aceita: para quem o middleware detecta como zh-CN, `<html lang>`, o banner de cookies e o widget de suporte saem no idioma do visitante em volta de copy pt-BR — é o estado atual da `/fundadores` |
| CTA | Um só, repetido 3×: **Assinar o MedChina**. Sem agendamento, sem formulário, sem captura de e-mail. O link carrega `origem` + `utm_*` completos (§4), não só `utm_content` |
| Oferta | Destino resolvido por `getSellableCampaign()` — oferta aberta **e** plano ativo, a mesma condição que a `/assinar` usa para vender — com `/planos` como fallback. **A publicação da página não espera a campanha abrir** (§4) |
| Preço | **Não aparece nesta página.** Preço vive em `campaign_offer` e quem anuncia preço é a `/assinar` |

---

## 0.1 Esta página NÃO é a página do evento

São quatro páginas, quatro públicos, e a diferença que importa é **tempo de vida**:

| Página | Quem chega | Vida | CTA |
|---|---|---|---|
| `/china` | Frio e morno: busca, imprensa, retargeting, o link da proposta ao IFPR | Permanente, indexada | Assinar o MedChina |
| Página do evento (`/lei-15345`, grupo `(funil)` — `docs/PAGINA-EVENTO.md`) | A base e quem chega por ela: quem já tem conta, ex-pagantes, orgânico e anúncio; os ~500 antigos só com a base legal documentada | Semanas, `noindex` | Quero participar |
| `/assinar` | Quem já decidiu | Permanente, `noindex` | Checkout da campanha |
| `/fundadores` | Base quente, com condição e vagas | Conforme a campanha, `noindex` | Checkout da condição |

Fundi-las estraga as duas: uma página de inscrição indexada vira, duas semanas depois, um resultado
de busca convidando para um evento que já aconteceu; uma página permanente com contagem regressiva
fica obsoleta no dia seguinte. É a mesma razão pela qual `/assinar` é `noindex` e `/planos` não.

**A `/china` não menciona o evento, e isso é decisão, não esquecimento.** Quem chega nela veio por
uma notícia, não por um convite: oferecer a alguém frio um compromisso com data e hora converte
pouco e ainda tira essa pessoa do caminho de compra. O evento é distribuído pelos canais próprios
(e-mail à base, WhatsApp, aviso in-app, orgânico) e não depende de busca.

O que as duas compartilham é **material, não página**: as mesmas fotos, o mesmo vídeo de endosso, os
mesmos slides, em duas montagens diferentes. Ao construir a página do evento, leia os assets de
`public/images/china/` e `public/videos/china/` — não duplique arquivo.

**O evento também fecha em assinatura, não em call.** Com a venda self-service decidida, o último
bloco do evento manda o link do plano no chat, ao vivo. Depois que ele acontece, a página dele vira
gravação + condição e aponta para `/assinar` ou `/fundadores` — aí sim pode ser linkada de qualquer
lugar, porque parou de ter data.

> **As duas dependências que ficavam em aberto aqui foram resolvidas em `docs/PAGINA-EVENTO.md`:** a
> inscrição persiste na entidade de lead do FUNIL T2.0 (migração `0112_leads.sql`, §3 de lá), e a
> decisão de venda self-service, em vez de call e `/agendar`, é registrada no FUNIL.md como parte da
> entrega (§16 de lá).

---

## 0.2 Por que um route group irmão, e não `(marketing)`

A versão anterior desta spec colocava a página em `(marketing)` "porque precisa do cabeçalho". Isso
não funciona por três motivos verificados no código:

1. **O layout de `(marketing)` monta o chrome da biblioteca** (`MarketingHeader` em MUI,
   `MarketingFooter` em Tailwind, um `<main>`) em volta de todo filho. A home só escapa disso pelo
   hack `body:has(.clinical-source-home) header:not(.site-header) { display: none }`
   (`clinical-source-home.css:109-112`), que o `docs/FUNIL.md:340` manda **não repetir**. Sem o hack,
   dois sistemas de design numa página; com o hack, a página fica sem cabeçalho nenhum — o oposto do
   que se queria.
2. **O lint bloqueia a Landing DS dentro de `(marketing)`.** Simulado com `marketing-lint.mjs`: um
   `page.tsx` fiel à §2 é recusado por `[icon-import]` (Phosphor direto) e um `china.css` com
   `rgba()`/hex por `[raw-color]`; `LANDING_DS_PATTERNS` (linhas 57-69) só isenta `(funil)`,
   `clinical-source-home.*` e `home-*`. A regra `[library-bypass]` (130-133) nem é gated pela isenção.
3. **Os hooks nem disparam fora de `(marketing)` e `components/marketing`** (filtros em
   `marketing-lint.mjs:193` e `marketing-guard.mjs:57`). `/fundadores` e `/assinar` "passam" porque
   nunca são lintadas, não por isenção — o item antigo do checklist "seguir o padrão de `/fundadores`"
   descrevia um padrão que não existe.

O padrão da casa para "esta página precisa de um chrome diferente" é um **route group irmão com
layout próprio**, já usado três vezes: `(funil)`, `palestra` e `pitch` ("a nested layout cannot
remove what its parent mounts"). O `(funil)` não serve porque seu contrato é o inverso do nosso: sem
menu de propósito, logo sem link, `noindex` e fora do sitemap (D10).

**Custo aceito:** nesse grupo nem o guard nem o lint rodam (igual às páginas do funil hoje), então o
checklist §7 é a verificação. **Opcional e coerente:** ampliar os filtros de disparo dos dois hooks
para `(funil)` e `(autoridade)` — isso torna alcançável o padrão morto de `LANDING_DS_PATTERNS:59`,
mantém a isenção token/ícone/i18n e faz valer o que `.claude/rules/marketing.md:6` já afirma (que o
guard dispara em `(funil)` — hoje não dispara).

---

## 1. Arquivos

| Arquivo | Ação |
|---|---|
| `src/app/(autoridade)/layout.tsx` | criar — importa `../(marketing)/clinical-source-home.css` e `../landing-shared.css`; renderiza `HomeHeader` + `HomeFooter`; remonta `MarketingTrackers` + `MarketingAnalytics` + `CookieConsent` + `SupportWidget` (copiar de `(funil)/layout.tsx:80-83`); emite o JSON-LD `Organization`/`WebSite` (§2) |
| `src/app/(autoridade)/china/page.tsx` | criar — a página |
| `src/app/(autoridade)/china/china-content.ts` | criar — a única fonte dos fatos da página: datas ISO, foto do palco (ou `null`), slides, citação, material de imprensa |
| `src/app/(autoridade)/china/china.css` | criar **desde o dia 1** — variante do herói (§3), bloco do vídeo, faixa editorial, seção de imprensa. Só o que é exclusivo da página, como `fundadores.css` faz |
| `src/app/(autoridade)/china/opengraph-image.tsx` → `.jpg` | nasce como cartão de texto (espelhar `(funil)/assinar/opengraph-image.tsx`) e é **substituído** por `opengraph-image.jpg` + `opengraph-image.alt.txt` quando a foto chegar (§6). Um segmento não aceita os dois ao mesmo tempo |
| `src/app/landing-shared.css` | criar — **mover** (não copiar) `.offer-founder`, `.offer-founder-photo`, `.offer-founder-role`, o `@media (max-width: 720px)` deles e `.offer-section--tinted` de `(funil)/funil.css`; importar em `(funil)/layout.tsx` e em `(autoridade)/layout.tsx`. É o que o próprio `funil.css:58-64` prevê ("a third campaign page should need no CSS of its own") |
| `src/components/marketing/home-header.tsx` / `home-footer.tsx` | criar — extrair `Header`, `Brand` e o `<footer>` de `clinical-source-home.tsx` (658-707, 1060-1090) com prop `links` (âncoras na home, rotas absolutas aqui), `showSignUp` e `showLanguage`; a home passa a consumi-los. Prefixo `home-` já é isento no lint |
| `src/components/marketing/home-evidence.tsx` | criar — extrair `SupervisedEvidence`, `EvidenceRow` e `EVIDENCE_FIELDS` (`clinical-source-home.tsx:340-478`), exportar; a seção 5 renderiza com `homeCopyPtBR.supervised` |
| `src/components/consent/track-click.tsx` | criar — `"use client"`, um `<a className="button">` que chama `track()` no clique (§2). Fora do lint por caminho |
| `src/lib/campaign-offer.ts` | editar — `getSellableCampaign()` (§2); `/assinar` passa a usar o mesmo helper na linha 101 |
| `src/lib/offer-angles.ts` | editar — novo slug `china` (§4) |
| `src/middleware.ts` | editar — `"/china"` em `PUBLIC_PREFIXES` **com comentário próprio** (landing indexada), não sob o comentário do `(funil)` |
| `src/app/sitemap.ts` | editar — `"/china"` em `MARKETING_ROUTES`; uma linha no bloco de exclusões explicando por que `/china` é indexada enquanto `/assinar` não |
| `src/app/palestra/publica/page.tsx` + `src/components/presentation/public-deck.tsx` | criar — o deck saneado (§3, seção 3) |
| `public/images/china/`, `public/videos/china/` | assets (§6) |
| `docs/SEO.md` | registrar a linha da `/china` na tabela por página antes de escrever title/description |
| `docs/TRACKING.md` | registrar `CtaClick` na tabela de eventos de cliente |
| `docs/press/release.md`, `docs/press/bio.md` | criar — release e bio da fundadora (seção 8) |
| `.claude/rules/marketing.md:4, 6, 11` · `docs/DESIGN.md:85` · `apps/web/CLAUDE.md:21` | editar — hoje dizem que Landing DS vive só em `(funil)` ou na home; passam a incluir "ou num route group irmão com layout próprio (precedente `palestra`/`pitch`/`(autoridade)`)". Só CLAUDE.md e rules regeneram o `AGENTS.md` (sync + add + commit num comando só, pela armadilha de CRLF) |
| `src/app/palestra/page.tsx:15-16` · `src/app/sitemap.ts:25-31` | editar — o comentário "the one documented exception" deixa de ser verdade quando `/palestra/publica` existir; e o relato do tratamento citado ali **não está** em `slides-data.ts` (só nos attachments) — corrigir o comentário |

**`PUBLIC_PREFIXES` não é opcional.** O middleware redireciona para `/auth/sign-in` toda rota que
não seja `/` ou um prefixo dessa lista (`isPublic`, usado em `if (!user && !isPublic(pathname))`).
Sem essa linha a página existe e ninguém deslogado a abre.

---

## 2. Contrato da rota

### O layout do grupo

```tsx
// src/app/(autoridade)/layout.tsx
import "../(marketing)/clinical-source-home.css";
import "../landing-shared.css";

import { BRAND } from "@/brand";
import CookieConsent from "@/components/consent/cookie-consent";
import MarketingAnalytics from "@/components/consent/marketing-analytics";
import MarketingTrackers from "@/components/consent/marketing-trackers";
import HomeFooter from "@/components/marketing/home-footer";
import HomeHeader from "@/components/marketing/home-header";
import JsonLd from "@/components/marketing/json-ld";
import SupportWidget from "@/components/support/support-widget";
import { getSupportChannels } from "@/lib/platform-settings";

const NAV = [
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/recursos", label: "Recursos" },
  { href: "/planos", label: "Planos" },
  { href: "/seguranca", label: "Segurança" },
];

export default async function AuthorityLayout({ children }: { children: React.ReactNode }) {
  const support = await getSupportChannels();
  return (
    <>
      {/* Organization + WebSite com @id: o layout de (marketing) emite isso só para o
          grupo dele. Extrair o bloco de (marketing)/layout.tsx:35-56 para
          components/marketing/site-json-ld.tsx e usar nos dois layouts. */}
      <JsonLd data={SITE_GRAPH} />
      <HomeHeader links={NAV} showSignUp={false} showLanguage={false} />
      {children}
      <HomeFooter />
      <SupportWidget support={support} />
      <CookieConsent />
      <MarketingTrackers />
      <MarketingAnalytics />
    </>
  );
}
```

### A página

```tsx
// src/app/(autoridade)/china/page.tsx
import "./china.css";

import type { Metadata } from "next";

import TrackClick from "@/components/consent/track-click";
import TrackEvent from "@/components/consent/track-event";
import HomeEvidence from "@/components/marketing/home-evidence";
import JsonLd from "@/components/marketing/json-ld";
import { BRAND } from "@/brand";
import { getSellableCampaign } from "@/lib/campaign-offer";
import { HERO_IMAGE } from "@/lib/offer-angles";
import { CHINA } from "./china-content";

/**
 * Toda rota já é dinâmica (o root layout lê cookies() e headers() via next-intl),
 * mas o destino do CTA depende de `Date.now()` em campaign-offer.ts:70. Declarar
 * torna a intenção explícita em vez de herdada de código alheio. `revalidate`
 * seria ignorado aqui — um layout que lê headers() nunca é ISR.
 */
export const dynamic = "force-dynamic";

// 51 caracteres + " · MedChina" = 62. O contrato pede ~60 (docs/SEO.md:25).
const PAGE_TITLE = "O prontuário brasileiro de MTC apresentado na China";
// 158 caracteres (contrato: 150–160). Palestra em 19/09/2026, confirmada em 2026-09-26.
const PAGE_DESCRIPTION =
  "Em 19 de setembro de 2026 o MedChina foi apresentado no Congresso de MTC de Xinjiang, na China. " +
  "O que isso tem a ver com a Lei 15.345 e com o seu consultório.";

export const metadata: Metadata = {
  title: { absolute: `${PAGE_TITLE} · MedChina` },
  description: PAGE_DESCRIPTION,
  // INDEXADA de propósito — ao contrário de /assinar e /fundadores, que são
  // noindex por decisão D10 de docs/FUNIL.md. Esta página é SEO, imprensa e o
  // link da proposta institucional; ela não anuncia preço, então não compete
  // com /planos.
  alternates: { canonical: "/china" },
  // Sem `images`: a convenção de arquivo (opengraph-image.*) registra a imagem,
  // e o card do Twitter reaproveita a mesma.
  openGraph: { title: `${PAGE_TITLE} · MedChina`, description: PAGE_DESCRIPTION, type: "article", locale: "pt_BR", siteName: "MedChina", url: "/china" },
  twitter: { card: "summary_large_image", title: `${PAGE_TITLE} · MedChina`, description: PAGE_DESCRIPTION },
};

/**
 * Tudo que o relatório lê, não só o que o herói lê. `resolveAngle` continua
 * decidindo o ângulo pelo prefixo de `utm_content`; `origem`, `utm_source` e
 * `utm_campaign` são o que o console de contas (0104) e o enriquecimento do
 * Purchase (signup-attribution.ts) de fato expõem. Só com `utm_content`, a
 * métrica 3 da §10 não tem como ser respondida.
 */
const CTA_CAMPAIGN =
  "/assinar?origem=china&utm_source=china&utm_medium=site&utm_campaign=china-autoridade&utm_content=china-autoridade-v1";

export default async function ChinaPage() {
  // O destino NÃO pode ser fixo: esta página fica no ar para sempre (SEO,
  // release, proposta ao IFPR) e a campanha não. Com a oferta fechada, a
  // /assinar mostra "condição encerrada" — mandar tráfego de imprensa para lá
  // é o pior desfecho possível. /planos nunca fecha.
  //
  // E a condição tem de ser a MESMA que a /assinar usa para vender: oferta
  // aberta E plano ativo (getPlanBySlug filtra is_active e devolve null sem
  // service key). `offer && !offer.closed` sozinho deixa a /china apontar para
  // uma /assinar que renderiza "não está aberta no momento".
  const sellable = await getSellableCampaign();
  const ctaHref = sellable ? CTA_CAMPAIGN : "/planos";
  // ...
  return (
    <main className="clinical-source-home china-page">
      <TrackEvent event="ViewContent" props={{ content_name: "china", content_category: "authority" }} />
      <JsonLd data={articleJsonLd(ctaHref)} />
      {/* ... seções ... */}
      <TrackClick className="button" href={ctaHref} event="CtaClick" props={{ content_name: "china", destination: ctaHref }}>
        Assinar o MedChina
      </TrackClick>
    </main>
  );
}
```

```ts
// src/lib/campaign-offer.ts — acrescentar
import { getPlanBySlug, type PublicPlan } from "@flyee/billing/public";

/** A oferta que a /assinar de fato vende: aberta E com plano ativo. Uma regra, dois leitores. */
export async function getSellableCampaign(): Promise<{ offer: CampaignOffer; plan: PublicPlan } | null> {
  const offer = await getCampaignOffer();
  if (!offer || offer.closed || !offer.planSlug) return null;
  const plan = await getPlanBySlug(offer.planSlug);
  return plan ? { offer, plan } : null;
}
```

**JSON-LD** (`<JsonLd data={...} />`, um por página; `Organization`/`WebSite` vêm do layout do grupo):

```ts
{
  "@context": "https://schema.org",
  // Article, não NewsArticle: a página é da própria empresa, permanente e com CTA
  // de venda — "representação verdadeira" e "tipo mais específico aplicável"
  // (políticas de dados estruturados do Google). NewsArticle fica para o
  // release, se um veículo o publicar.
  "@type": "Article",
  headline: PAGE_TITLE,
  datePublished: CHINA.publishedAt,   // ISO com fuso, ex. "2026-09-30T09:00:00-03:00"
  dateModified: CHINA.modifiedAt,     // sobe a cada seção acrescentada (3, 4, 8)
  author: { "@type": "Person", name: "Debora Giovanella", jobTitle: "Fundadora do MedChina" },
  publisher: { "@id": `${BRAND.siteUrl}/#organization` },
  ...(CHINA.stagePhoto
    ? { image: [`${BRAND.siteUrl}/images/china/palco-1200.jpg`, `${BRAND.siteUrl}/images/china/palco.webp`] }
    : {}),
  mainEntityOfPage: `${BRAND.siteUrl}/china`,
}
```

**Tracking:** o layout do grupo remonta Pixel e GA4. `ViewContent` com `content_name: "china"` na
montagem (padrão de `/assinar` e `/fundadores`) e **`CtaClick`** no clique — um evento custom
reutilizável, parametrizado por `content_name` + `destination`, fora da lista de eventos-padrão da
Meta, então cai em `trackCustom` e nunca vira evento de otimização. Registrar em `docs/TRACKING.md`
(o mapa canônico, `docs/FUNIL.md:431`). **Nada otimizado por criação de conta** — regra permanente do
`docs/FUNIL.md`.

```tsx
// src/components/consent/track-click.tsx
"use client";

import { track } from "@/lib/analytics";

export default function TrackClick({ event, props, href, className, children }: {
  event: string; props?: Record<string, unknown>; href: string; className?: string; children: React.ReactNode;
}) {
  return (
    <a className={className} href={href} onClick={() => track(event, props)}>
      {children}
    </a>
  );
}
```

---

## 3. As oito seções

A ordem é a da persuasão. As classes são o vocabulário do Landing DS (`clinical-source-home.css`) —
as mesmas que a home e a `/fundadores` usam, e é isso que faz as três telas parecerem a mesma empresa.

| # | Seção | Vocabulário | Depende do material da China? |
|---|---|---|---|
| 1 | Herói | `.hero` `.hero-inner` `.hero-copy` `.eyebrow` `.hero-lead` `.hero-actions` `.hero-stage` `.hero-composite` + variante em `china.css` (abaixo) + um satélite da DS (`.platform-badges` ou `.insight-stack`) com "Xinjiang · 2026" | foto (com fallback) |
| 2 | O marco legal | `.presence-section` `.presence-heading` `.eyebrow--light` — **sem** `.section` (a banda escura já tem padding; `.section-heading` e `.eyebrow` sairiam apagados sobre `#052f2e`) | não |
| 3 | O que foi apresentado | `.section` `.section-heading` + faixa editorial em `china.css`, máx. 4 imagens, um link para `/palestra/publica` | **sim** |
| 4 | O endosso | `.section` + citação **como texto** + `<video poster preload="none">` com `<track kind="captions">` | **sim** |
| 5 | A ponte para o produto | `<HomeEvidence copy={homeCopyPtBR.supervised} />` — o bloco `SupervisedEvidence` da home, extraído (§1). Não é prosa: é um mockup interativo com estado de cliente, e a página é Server Component | não |
| 6 | Quem está por trás | `.offer-founder` `.offer-founder-photo` `.offer-founder-role` (de `landing-shared.css`, §1) | não |
| 7 | CTA final | `.final-cta` `.button` | não |
| 8 | Para imprensa | `.section` discreto + `.press-*` em `china.css`, antes do rodapé | **sim** |

### O herói precisa de CSS, e é a primeira coisa a orçar

O palco da DS foi ajustado para o composite **retrato** do produto: `.hero-composite img` é absoluto a
85% de largura com `top: -26px` sobre um gradiente teal com máscara à esquerda
(`clinical-source-home.css:617-636`), e há overrides em quatro breakpoints (base, ≤1180, ≤900, ≤640).
Uma foto 3:2 nesse palco deixa um terço de gradiente vazio embaixo. Em `china.css`, escopado à raiz
da página como `funil.css` faz com `.offer-page`:

```css
.china-page .hero-composite { mask-image: none; -webkit-mask-image: none; }
.china-page .hero-composite img { top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transform: none; max-width: none; }
/* repetir nos três breakpoints que sobrescrevem `.hero-composite img` (≤1180, ≤900, ≤640) */
```

Uma foto crua ainda é "um retângulo chato" para o item 9 do premium bar (`docs/DESIGN.md:48`); o
satélite da DS sobreposto ("Xinjiang · 2026") resolve sem mockup.

### Publique com 6, não espere as 8

Seções 3, 4 e 8 ficam **condicionais ao material existir** (`CHINA.slides.length > 0`, `CHINA.quote`,
`CHINA.press`). A página vai ao ar antes do material chegar e cresce depois. Dois motivos: indexação
leva tempo, e a mesma regra que rege o prontuário rege a página — ausência não vira negação, então um
bloco de citação sem citação não aparece vazio, simplesmente não existe.

A seção 1 **também** depende da foto, e uma página indexada não pode ir ao ar com um herói rotulado,
um preview vazio no WhatsApp e um `image` de JSON-LD respondendo 404. Por isso:

- enquanto `CHINA.stagePhoto` for `null`, o herói usa a `HERO_IMAGE` de `lib/offer-angles.ts` (o
  palco foi ajustado para ela) e a variante acima fica inerte; eyebrow e lead não mudam;
- o JSON-LD só emite `image` quando a foto existir;
- a OG nasce como cartão de texto (`opengraph-image.tsx`, espelho da `/assinar`) e vira
  `opengraph-image.jpg` quando a foto chegar.

Placeholders nos blocos condicionais seguem a regra do §9: proporção exata e rótulo do que vai ali.

### A exceção deliberada do herói, e o que a verificação visual julga aqui

`docs/DESIGN.md` exige evidência de produto acima da dobra. Aqui a evidência acima da dobra é a prova
do congresso, porque é ela que compra a atenção nesta página. **Registre isso num comentário no topo
do arquivo** (precedente: o comentário de `HERO_IMAGE` em `offer-angles.ts:33-41`), senão alguém
"corrige" trocando a foto por um mockup. A evidência de produto entra na seção 5.

A `marketing-verify` foi escrita para páginas da biblioteca: satélites `data-composition-satellite`,
`<ProductComposition>` e `<Reveal>` não existem na Landing DS e falham por construção; e a DS não tem
modo escuro (`docs/DESIGN.md:102`), então as capturas escuras só exercitariam nada. O que se julga
numa página Landing DS: capturas a 375/768/1440 **claro**, densidade a 1440 (nenhum viewport >50%
vazio), overflow a 375, ≥2 trocas de fundo, fonte display TT Chocolates, e "nada aqui é um componente
genérico com texto novo". Vale adicionar um ramo "Landing DS" à skill.

---

## 4. O ângulo `china` em `src/lib/offer-angles.ts`

Duas edições: o tipo e o mapa. Sem isso, quem sai de uma página sobre o congresso cai num herói sobre
outra coisa e sente a emenda — é o message match que o comentário do arquivo descreve.

```ts
export type AngleSlug = "presenca" | "memoria" | "confianca" | "mtc" | "plano" | "china";

china: {
  eyebrow: "Apresentado no Congresso de MTC em Xinjiang, China",
  title: "A medicina é milenar.",
  accent: "O registro dela não precisa ser.",
  lead: "Grave a consulta com a autorização da paciente e receba a anamnese preenchida, na estrutura da MTC, pronta para a sua revisão. Você conduz a consulta; a plataforma prepara o registro.",
},
```

`resolveAngle` lê o prefixo do `utm_content`, então qualquer `china-*` cai aqui e um valor
desconhecido volta para `presenca` em vez de quebrar. Use `china-autoridade-v1` no link da página e
`china-<formato>-<gancho>-v1` nos anúncios de retargeting — sempre acompanhado de
`origem=china&utm_source=china&utm_medium=<canal>&utm_campaign=<campanha>` (§2), porque `utm_content`
sozinho não chega a nenhum relatório.

### Pré-requisito operacional — antes de ligar a campanha, não antes de publicar

A `/assinar` só vende com `campaign_offer.enabled = true` e `plan_slug` apontando para um plano ativo
(o `deadline` é opcional: nulo significa "sem prazo", e continua aberta). A migração `0107` semeia a
campanha com `enabled: false` de propósito — abrir é decisão de operador com data, e a compra de teste
real com PIX exige Asaas em produção, pagamento e estorno.

Como o CTA já cai em `/planos` enquanto a oferta não está à venda, **a `/china` publica sem esperar
nada disso**. No dia em que a caixa "Oferta aberta" for marcada: compra de teste real pela `/assinar`
via o link com `origem=china`, e conferir que a compra aparece com essa origem no console de contas.

---

## 5. Copy pronta

Escrita dentro das regras do repositório: a IA nunca diagnostica nem decide, ausência nunca vira
negação, nenhum número fabricado, voz feminina, vermelho só para risco. Grafia e cargo como em todas
as superfícies publicadas: **Debora** (sem acento) e **Fundadora do MedChina** (Bruno é "sócio").

### Seção 1 — Herói

- **Eyebrow:** Congresso de Medicina Tradicional Chinesa · Xinjiang, China · setembro de 2026
- **Título:** O prontuário brasileiro de Medicina Chinesa
- **Acento:** foi apresentado na China.
- **Lead:** Em janeiro, a acupuntura virou profissão regulamentada no Brasil. Oito meses depois, a plataforma que organiza o registro clínico de acupunturistas brasileiros subiu ao palco de um congresso de Medicina Tradicional Chinesa em Xinjiang, na China. *(12 de janeiro → 19 de setembro; a conta vive na mesma constante da data, `CHINA.eventDate`.)*
- **Botão:** Assinar o MedChina

### Seção 2 — O marco legal

- **Eyebrow:** Sancionada em 12 de janeiro de 2026
- **Título:** A acupuntura virou profissão regulamentada. O registro veio junto.
- **Corpo:**

> A Lei 15.345 regulamentou o exercício profissional da acupuntura no Brasil. Ela define quem pode
> exercer: graduação em acupuntura, diploma estrangeiro validado, título de especialista reconhecido
> pelo conselho, ou cinco anos ininterruptos de prática até 13 de janeiro de 2026, data de publicação
> da lei.
>
> O que muda no seu consultório não está no texto da lei — está no que vem depois dele. Uma profissão
> regulamentada responde pelo que fez, e responder pelo que fez começa pelo registro do que foi feito.
> O prontuário deixa de ser a agenda pessoal de cada terapeuta e passa a ser o documento da profissão.

- **Link de fonte, primário:** o texto da lei — Planalto
  (`https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/L15345.htm`) ou a publicação
  original na Câmara
  (`https://www2.camara.leg.br/legin/fed/lei/2026/lei-15345-12-janeiro-2026-798656-publicacaooriginal-177758-pl.html`).
  Para jornalista e reitor, linkar a lei, não a notícia.
- **Link secundário:** [como a Câmara noticiou](https://www.camara.leg.br/noticias/1238052-lei-regulamenta-exercicio-profissional-da-acupuntura)

> **Precisão obrigatória (verificada na publicação original em 2026-09-26):** a lei tem seis
> artigos e as palavras "prontuário" e "registro" não aparecem em nenhum. Ela regulamenta o exercício
> profissional; **não** cria obrigação de prontuário, eletrônico ou não. A copy acima diz exatamente
> isso e nada além — "o registro veio junto" e "documento da profissão" são o que vem *depois* da lei,
> e o parágrafo precisa continuar dizendo isso. Não escreva "a lei exige prontuário" em lugar nenhum.
> Detalhes do art. 3º que a copy resume: o inciso IV foi vetado; o inciso V diz "comprovada e
> ininterruptamente, há pelo menos 5 anos até a data da publicação" — por isso **ininterruptos**, não
> "contínuos" (a paráfrase do deck), e por isso 13/01 ao lado de 12/01 não é erro de digitação. O
> art. 5º permite a outras profissões da saúde procedimentos isolados de acupuntura.

### Seção 3 — O que foi apresentado

- **Título:** Do prontuário em papel ao prontuário inteligente
- **Corpo:** Os 23 slides que a Debora apresentou no congresso contam a história da medicina chinesa no Brasil, o caminho do MedChina e o que a plataforma faz hoje. Estão publicados em português e em chinês.
- **Contexto opcional (a frase do slide 19, dita no palco):** Desde 2019, Goiânia sedia o Instituto Confúcio de Medicina Chinesa, uma parceria entre a Universidade Federal de Goiás e a Universidade de Medicina Chinesa de Hebei.
- **Link:** Ver a apresentação → `/palestra/publica`

**Por que não `/palestra`:** a rota é `noindex` e fora do sitemap justamente para manter o bastidor
fora da superfície comercial. O bundle entrega a todo visitante `script`, `scriptZh`, `stageNote`,
`optionalCut` e `productionNote`; o "Modo apresentador" é um botão visível na barra do projetor
(`slide-deck.tsx:734-751`) e o roteiro entra no PDF com um toggle (`?roteiro=1`). Uma página indexada
de imprensa não pode apontar para isso. **`/palestra/publica`:** Server Component que mapeia
`SLIDES_DATA` **sem** os campos de nota e sem os anexos, e passa o resultado como props para um
`<PublicDeck slides>` cliente em volta do `SlideRenderer` (mapear no cliente não resolve: o literal
inteiro continua embarcando). Herda `palestra/layout.tsx` (sem chrome) e o prefixo público
`/palestra`; fica `noindex` como `/pitch` — `/china` é a narrativa indexada. Zero código, se preciso
publicar antes: o PDF padrão de `/palestra/exportar` já sai sem roteiro; vai para a pasta de imprensa.

**Números do deck:** os slides trazem números da plataforma anterior (`PLATFORM_STATS`). Ou entram
no deck público apresentados como histórico (o que eram, quando, de onde vêm), ou o `publica` omite
esse slide. A §8.3 vale para tudo que estiver no domínio comercial.

### Seção 4 — O endosso

Uma citação só, com nome e cargo, **como texto** — o vídeo é a evidência da citação, não o contrário
(legenda gravada no pixel não é lida por leitor de tela nem por crawler). `<video>` com `poster`,
`preload="none"` e `<track kind="captions" srclang="pt-BR" default>`. Se vierem duas citações, a
segunda vai para a seção 8. Sem citação disponível, a seção não é renderizada.

### Seção 5 — A ponte para o produto

- **Eyebrow:** O que o MedChina faz
- **Título:** O problema nunca foi falta de ficha. Foi digitar enquanto ela falava.
- **Corpo:**

> Você já registra. Registra há anos — digitando durante a consulta, ou depois dela, à noite,
> tentando lembrar do que foi dito às 14h. O gargalo nunca foi a ausência de um sistema. Foi a
> atenção dividida entre a paciente e o teclado.
>
> O MedChina grava a consulta com a autorização da paciente e devolve a anamnese preenchida na
> estrutura da MTC — queixa, sono, digestão, emoções, língua, pulso — com cada campo mostrando o
> trecho do áudio que o originou. O que não foi dito fica em branco: ausência nunca vira negação.
> Nada é finalizado sem você. A inteligência artificial organiza o relato e prepara hipóteses; você
> revisa, edita, valida e assina.

Esta é a seção que decide se o clique chega quente na `/assinar`. Abaixo do texto, o bloco
`<HomeEvidence>` com os chips de estado (Evidência clara / Requer atenção / Não informado) — o motivo
assinatura que aparece na home e na `/assinar`, e que costura as três telas.

### Seção 6 — Quem está por trás

Reutilizar o bloco já validado de `/fundadores` e `/assinar` (foto `public/images/palestra/fundadora-debora.jpg`, que já existe):

> **Debora Giovanella** · Fundadora do MedChina · Terapeuta de Medicina Tradicional Chinesa
>
> Terapeuta desde 2017, com formação em shiatsu e em acupuntura, e 25 anos em gestão de marketing e
> vendas. Idealizou o 1º Congresso Práticas da Sabedoria Milenar, em 2020, e conduz a visão clínica
> do produto.
>
> O MedChina nasceu das fichas de papel que ela preenchia no próprio consultório, porque nenhum
> prontuário falava a língua da Medicina Tradicional Chinesa.

**Retirada a frase "o projeto mantém parceria institucional com o Instituto Confúcio":** não há
acordo documentado no repo, e o radar de 2026-09-02 registra que parceria institucional **não** foi
marcada como evidência autorizada. Se um acordo escrito existir, ele é arquivado com as autorizações
de imagem (§6) e citado em §8.5 antes de a frase voltar. O contexto do Instituto, como fato da cidade
e nas palavras do slide 19, cabe na seção 3 — não em "Quem está por trás", onde ainda implicaria
associação.

### Seção 7 — CTA final

- **Título:** A medicina é milenar. O registro dela não precisa ser.
- **Botão:** Assinar o MedChina

### Seção 8 — Para imprensa

> Fotos em alta resolução, release e bio da fundadora: [pasta de imprensa]. Entrevistas:
> contato@medchinaprontuarios.com.br
>
> Como citar: MedChina Gestão e Prontuários · CNPJ 38.504.491/0001-80 · Goiânia (GO)

Barata e quase ninguém faz. Um jornalista que precisa **pedir** foto em alta normalmente não pede —
escolhe outra pauta.

**Onde a pasta mora:** originais em alta não cabem em `public/` (deploy) nem em `attachments/`
(`attachments/README.md:9`: binários grandes não vivem lá). Decidir entre um bucket **público** do
Supabase Storage (já usado para avatares) e um link externo registrado como dependência. O release e
a bio são texto e vivem no repo: `docs/press/release.md` e `docs/press/bio.md`, escritos dentro da §8.

---

## 6. Assets

| Caminho | Conteúdo | Formato |
|---|---|---|
| `public/images/china/palco.webp` | Debora no palco ou ao lado do slide projetado — a imagem do herói | WebP, ~1600px de largura, `width`/`height` explícitos |
| `public/images/china/palco-1200.jpg` | a mesma foto para o `image` do JSON-LD (URL estável, ≥1200px) | JPEG, 1200px de largura |
| `src/app/(autoridade)/china/opengraph-image.jpg` + `opengraph-image.alt.txt` | o card de link | JPEG 1200×630. **WebP não serve**: o Satori embutido no Next lança `Unsupported image type: image/webp`, e a convenção estática só aceita jpg/jpeg/png/gif |
| `public/images/china/slides-01..04.webp` | até 4 slides do congresso | WebP |
| `public/images/china/credencial.webp` | crachá ou plaquinha com o nome em chinês | WebP |
| `public/videos/china/endosso.mp4` | endosso falado | MP4 H.264, 720p. **Tamanho:** o GitHub avisa a partir de 50 MiB e recusa acima de 100 (não há LFS); o precedente rastreado é `consulta-acelerada.mp4`, 17 MB. Acima disso, o arquivo vai para o apex como `depo-hellen.mp4`, com a linha no `.gitignore` |
| `public/videos/china/endosso.pt-BR.vtt` | legendas | WebVTT, `<track kind="captions">` |
| `public/images/china/endosso-poster.webp` | frame do vídeo | WebP |
| `public/images/palestra/fundadora-debora.jpg` | já existe — seção 6 | — |

**Regras.** Nada de embed de Instagram ou YouTube: a regra é a do `docs/FUNIL.md:378` — embed
injeta cookies antes do consentimento; ou MP4 self-hosted, ou click-to-load atrás do `CookieConsent`.
(A versão anterior desta spec falava num "contract que proíbe script externo"; não existe tal regra
no lint nem nas rules.) O apex `medchinaprontuarios.com.br` é da empresa, mas é **outra origem**
(Hostinger) que a do app (Vercel): um vídeo servido de lá não pode ser sondado e precisa de fallback
em `onError` (poster ou esconder o bloco), porque "sem material a seção não renderiza" é decisão de
servidor, não de runtime. O matcher do middleware já libera `images` e `videos`. `poster` +
`preload="none"` sempre; o `preload="auto"` do deck é para o palco, não para uma página.

Registrar a regra de vídeo (tamanho, formato, legendas, origem) em `docs/DESIGN.md:81`, na lista do
que vale para toda página Landing DS — para a próxima landing herdar.

**Fora do código:** arquive as autorizações de imagem, o convite do congresso e (se existir) o
acordo com o Instituto Confúcio junto ao material bruto. É o que segura a página de pé se alguém
reclamar.

---

## 7. Checklist antes do merge

- [ ] `"/china"` em `PUBLIC_PREFIXES` (`src/middleware.ts`), com comentário próprio — sem isso, visitante deslogado cai no sign-in
- [ ] `"/china"` em `MARKETING_ROUTES` (`src/app/sitemap.ts`)
- [ ] `metadata` estático com `alternates.canonical: "/china"` e **sem** `robots: noindex`; title ≤ ~60 e description 150–160 (medidos)
- [ ] OG registrada pela convenção de arquivo (cartão de texto até a foto; `opengraph-image.jpg` + `.alt.txt` depois) — é essa imagem que decide o clique no WhatsApp e no e-mail de imprensa
- [ ] `<JsonLd>` com `Article`, `publisher` por `@id`, `datePublished`/`dateModified` ISO reais; `Organization`/`WebSite` emitidos **pelo layout do grupo**, uma vez
- [ ] Linha da `/china` em `docs/SEO.md` antes do title/description
- [ ] `<TrackEvent>` de `ViewContent` + `<TrackClick>` de `CtaClick`; `CtaClick` registrado em `docs/TRACKING.md`
- [ ] Ícones Phosphor diretos e cores pelas custom properties do DS, como em `/assinar` (`docs/DESIGN.md:73,75`)
- [ ] `ctaHref` resolvido por `getSellableCampaign()`, com `/planos` como fallback; `/assinar` usa o mesmo helper
- [ ] Link do CTA com `origem` + `utm_source` + `utm_medium` + `utm_campaign` + `utm_content`
- [ ] `export const dynamic = "force-dynamic"` com o comentário do porquê
- [ ] Exceção do herói justificada em comentário no arquivo; fallback `HERO_IMAGE` funcionando sem a foto
- [ ] Seção 2 em `.presence-section` + `.presence-heading` + `.eyebrow--light`, sem `.section`
- [ ] Seção 5 via `<HomeEvidence>` extraído; a home continua renderizando igual
- [ ] `.offer-founder*` movidos para `landing-shared.css`; `/fundadores` e `/assinar` continuam iguais
- [ ] `/palestra/publica` sem `script`/`scriptZh`/`stageNote`/`optionalCut`/`productionNote` no HTML nem no bundle (conferir no view-source e no chunk)
- [ ] Vídeo com `poster`, `preload="none"`, `<track>` `.vtt` e `onError`; tamanho dentro da regra do §6
- [ ] Verificação visual como Landing DS (§3): 375/768/1440 claro, densidade a 1440, overflow a 375, ≥2 trocas de fundo, TT Chocolates, nada genérico
- [ ] Docs atualizados: `.claude/rules/marketing.md`, `docs/DESIGN.md:85`, `apps/web/CLAUDE.md:21`, comentários em `palestra/page.tsx` e `sitemap.ts`; `AGENTS.md` regenerado no mesmo commit
- [ ] Todos os itens de "Confirmar antes de publicar" (§8) fechados

---

## 8. Precisão factual — vale para a página, o release e os posts

1. **"Apresentado no Congresso de Medicina Tradicional Chinesa em Xinjiang, China (2026)."** É a
   única formulação com lastro no repo (`slides-data.ts:1259`, o roteiro da palestra). Nunca
   "oficial", nunca "internacional" (nenhuma fonte diz isso) até o organizador e o tipo do congresso
   estarem documentados pelo convite; nunca "usado na China", nunca "aprovado na China", nunca
   "parceria com o governo chinês".
2. **A lei regula o exercício profissional**, não o prontuário. Não invente exigência legal. Verbo da
   lei: "ininterruptamente"; data-limite: 13 de janeiro de 2026, publicação; sanção: 12 de janeiro.
3. **Nenhum número de usuários, de clínicas ou de consultas** que não venha do banco — inclusive os
   do deck, se o deck público os mostrar.
4. **A IA prepara hipóteses para revisão profissional.** Nunca diagnostica, nunca decide, nunca prescreve.
5. **Instituições e pessoas só aparecem com autorização** — imagem, citação e "parceria". O Instituto
   Confúcio aparece como fato da cidade (frase do slide 19), não como parceiro, até haver acordo
   escrito arquivado.
6. **Nome, tipo, organizador, cidade e data do congresso vêm do convite**, arquivado com o material.

### Confirmar antes de publicar (com a Debora)

- ✅ **Data da palestra: 19 de setembro de 2026** (confirmada em 2026-09-26). Vive numa única
  constante (`CHINA.eventDate`), da qual saem o eyebrow, a description e o "oito meses depois". O
  `datePublished` é a data em que a **página** vai ao ar, não a da palestra.
- **O que é "ALAR".** O kicker do deck diz "Congresso de MTC · ALAR / Xinjiang". Nenhuma busca em
  pt, en ou zh encontrou entidade com esse nome; a hipótese mais provável é a **cidade** de Alar/Aral
  (阿拉尔), no sul de Xinjiang. Se for isso, o eyebrow diz "Alar, Xinjiang" e nenhuma "organização
  ALAR" é citada.
- **Organizador e tipo do congresso**, pelo convite (é o que permitiria, ou não, um qualificativo).
- **Instituto Confúcio:** manter a frase do slide 19 na seção 3 ou omitir. Fato verificado nas fontes
  da UFG: acordo assinado em 25/10/2019 em Pequim, com a Universidade de Medicina Chinesa de Hebei
  **e** a Universidade de Estudos Estrangeiros de Tianjin; inauguração física depois. "Desde 2019"
  se sustenta pela data do acordo.
- **Autorizações** de imagem (foto do palco, credencial, slides com pessoas) e da citação do endosso.

---

## 9. Ordem de construção

| # | Bloco | Esforço | Espera material? |
|---|---|---|---|
| 1 | Extrair `home-header`, `home-footer` e `home-evidence` da home; home consumindo os três sem mudança visual | 2 h | não |
| 2 | `(autoridade)/layout.tsx` + `site-json-ld.tsx` compartilhado + `landing-shared.css` (mover de `funil.css`) | 1,5 h | não |
| 3 | `getSellableCampaign()` usado em `/assinar` e `/china`; ângulo `china` | 1 h | não |
| 4 | Rota, `china-content.ts`, esqueleto das 8 seções, variante do herói em `china.css`, fallback `HERO_IMAGE`, placeholders dimensionados | 3 h | não |
| 5 | Copy das seções 2, 5, 6 e 7 (§5, pronta para colar) | 1 h | não |
| 6 | Metadata, OG de texto, JSON-LD, sitemap, middleware, `track-click` + `docs/TRACKING.md` | 1,5 h | não |
| 7 | `/palestra/publica` + `<PublicDeck>`; conferir bundle sem notas | 2 h | não |
| 8 | Docs e harness: `marketing.md`, `DESIGN.md`, `apps/web/CLAUDE.md`, `SEO.md`, comentários em `palestra/page.tsx` e `sitemap.ts`, `AGENTS.md` | 1 h | não |
| 9 | Encaixe de foto, vídeo (+ `.vtt`) e citação (seções 1, 3, 4); trocar OG para `.jpg`; `image` no JSON-LD | 1,5 h | sim |
| 10 | Sala de imprensa: `docs/press/*`, pasta de originais, seção 8 | 2 h | sim |
| 11 | Verificação visual como Landing DS e ajustes de densidade | 1 h | — |

Cerca de **17 horas**, das quais 13 não esperam por nada que esteja na China. A estimativa anterior
(8 h) não contava o layout do grupo, a extração dos blocos da home, o deck público e a movimentação
de CSS.

**Placeholders que não mentem sobre o layout:** nada de retângulo cinza genérico. Use um bloco com a
proporção final exata e um rótulo do que vai ali ("foto do palco, 3:2"). O layout não se mexe quando
a foto real entrar, e você não descobre um buraco de composição no dia da publicação.

---

## 10. Como saber se a página pagou o trabalho

Cadeia: visita em `/china` → clique no CTA (`CtaClick`, `content_name: "china"`) →
`/assinar?origem=china&utm_source=china&…&utm_content=china-autoridade-v1` → first-touch gravado
pelo middleware (`origem`, `utm_*`, `landing_path`) → checkout → compra com origem.

1. **Taxa de clique no CTA da `/china`** — `CtaClick` ÷ `ViewContent`, ambos com
   `content_name: "china"`. O único número que julga a página em si. Em tráfego morno, abaixo de ~8%
   quer dizer que a seção 5 não fez a ponte: a pessoa se impressionou com a China e não entendeu o
   produto.
2. **Conversão da `/assinar` para `china-*` contra os outros ângulos** — muito pior significa
   temperatura, não página; a correção é na `/china`.
3. **Assinaturas com `origem = china`** — o número que fecha a conta. Legível no console de contas
   (`origem`, `utm_source`, `utm_campaign`, `landing_path` — migração 0104) e no enriquecimento do
   `Purchase`. Só `utm_content` não chegaria a nenhum dos dois: por isso o link carrega os cinco
   parâmetros.

Nada otimizado nem reportado por criação de conta.

Duas ressalvas de leitura: o first-touch nunca é sobrescrito, então quem já tinha um cookie de
campanha não conta para a `/china`; e o `landing_path` gravado é a página que recebeu os parâmetros,
`/assinar`, não `/china` — a origem é o que identifica esta página.

O que nenhum desses números captura: esta página também é o anexo do release e o link da proposta ao
IFPR. Mantenha uma lista de para quem o link foi enviado e o que voltou — é metade do valor dela.

---

## 11. O que a implementação fez diferente deste texto (2026-09-26)

- **O deck público omite os anexos e dois slides de palco** (`platform-today` e `testimony-user`), além
  de todo o texto de palco. Roteiro (`script`), nota de palco (`stageNote`) e `media.productionNote` são
  esvaziados **no servidor**, antes de qualquer coisa chegar ao cliente; `public-deck.tsx` recebe os
  slides por prop e nunca importa `slides-deck.ts`. Verificado no HTML e nos chunks servidos.
- **O deck público funciona no celular.** O deck de palco supõe um projetor de 1280 px ou mais; abaixo
  disso a grade do palco jogava o slide escalado para fora da tela. O público (`.deck--public`) centraliza
  o canvas por posição, esconde a linha de contexto abaixo de 900 px e, com o celular em pé, diz uma vez
  "Gire o celular para ver os slides maiores."
- **Linha de garantia no herói:** "A inteligência artificial prepara, você revisa, valida e assina." —
  a mesma trava de linguagem clínica da home, no lugar em que o CTA aparece pela primeira vez.
- **A frase do Instituto Confúcio foi mantida** (§8), como fato da cidade dito no slide 19, nunca como
  parceria do MedChina.
