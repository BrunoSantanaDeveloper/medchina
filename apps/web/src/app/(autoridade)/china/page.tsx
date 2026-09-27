/*
  THE DELIBERATE HERO EXCEPTION — read before "fixing" the hero.

  docs/DESIGN.md asks for product evidence above the fold. On THIS page the
  evidence above the fold is the proof of the congress, because that is what
  buys the attention here: the visitor came for "the Brazilian TCM record
  presented in China", not for a feature tour. The product evidence is
  section 5 (the supervised-anamnesis demo), and the premium bar is met by the
  page as a whole (docs/PAGINA-CHINA.md §3). Until the stage photo exists
  (china-content.ts → stagePhoto), the stage shows the product composite.
  Do not replace a future stage photo with a mockup.
*/
import "./china.css";

import { CHINA, EVENT_MONTH_LABEL, LAW_SOURCES, MONTHS_LAW_TO_TALK } from "./china-content";
import type { Metadata } from "next";

import { BRAND } from "@/brand";
import TrackClick from "@/components/consent/track-click";
import TrackEvent from "@/components/consent/track-event";
import { homeCopyPtBR } from "@/components/marketing/home-copy/pt-BR";
import HomeEvidence from "@/components/marketing/home-evidence";
import JsonLd from "@/components/marketing/json-ld";
import { getSellableCampaign } from "@/lib/campaign-offer-server";
import { HERO_IMAGE } from "@/lib/offer-angles";
import {
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  Envelope,
  MapPin,
  PresentationChart,
  Scales,
} from "@phosphor-icons/react/dist/ssr";

/**
 * Every route is already dynamic (the root layout reads cookies() and headers()
 * through next-intl), but the CTA's destination depends on the clock
 * (campaign-offer.ts: `deadline <= Date.now()`). Declaring it makes that intent
 * explicit instead of inherited from unrelated code. `revalidate` would be
 * ignored here — a layout that reads headers() is never ISR.
 */
export const dynamic = "force-dynamic";

// 51 characters + " · MedChina" = 62 (docs/SEO.md: ~60).
const PAGE_TITLE = "O prontuário brasileiro de MTC apresentado na China";
// 158 characters (docs/SEO.md: 150–160).
const PAGE_DESCRIPTION =
  "Em 19 de setembro de 2026 o MedChina foi apresentado no Congresso de MTC de Xinjiang, na China. " +
  "O que isso tem a ver com a Lei 15.345 e com o seu consultório.";

export const metadata: Metadata = {
  // `absolute`: the root layout appends "| MedChina" to every title.
  title: { absolute: `${PAGE_TITLE} · MedChina` },
  description: PAGE_DESCRIPTION,
  // INDEXED on purpose — unlike /assinar and /fundadores, which are noindex by
  // decision D10 of docs/FUNIL.md. This page is search, press and the link of
  // the institutional proposals; it announces no price, so it does not compete
  // with /planos. No `robots` key: indexable by default.
  alternates: { canonical: "/china" },
  // No `images`: the opengraph-image file next to this page registers the card,
  // and the Twitter card reuses it.
  openGraph: {
    title: `${PAGE_TITLE} · MedChina`,
    description: PAGE_DESCRIPTION,
    type: "article",
    locale: "pt_BR",
    siteName: "MedChina",
    url: "/china",
  },
  twitter: { card: "summary_large_image", title: `${PAGE_TITLE} · MedChina`, description: PAGE_DESCRIPTION },
};

/**
 * Everything the reports read, not only what the hero reads. `resolveAngle` on
 * /assinar still picks the `china` angle from the `utm_content` prefix; origem,
 * utm_source and utm_campaign are what the accounts console (0104) and the
 * Purchase enrichment actually expose. With utm_content alone, "did /china sell
 * anything?" could not be answered (docs/PAGINA-CHINA.md §10).
 */
const CTA_CAMPAIGN =
  "/assinar?origem=china&utm_source=china&utm_medium=site&utm_campaign=china-autoridade&utm_content=china-autoridade-v1";

export default async function ChinaPage() {
  // The destination CANNOT be fixed: this page stays up for good (search, the
  // release, proposals) and the campaign does not. With the offer closed,
  // /assinar shows "condição encerrada" — the worst place to send press
  // traffic. /planos never closes. And the question must be the SAME one
  // /assinar asks before selling: offer open AND plan active.
  const sellable = await getSellableCampaign();
  const ctaHref = sellable ? CTA_CAMPAIGN : "/planos";
  const cta = (placement: string, className = "button") => (
    <TrackClick
      className={className}
      href={ctaHref}
      event="CtaClick"
      props={{ content_name: "china", placement, destination: sellable ? "assinar" : "planos" }}
    >
      Assinar o MedChina <ArrowRight size={18} />
    </TrackClick>
  );

  const photo = CHINA.stagePhoto;

  return (
    <main className="clinical-source-home china-page">
      <TrackEvent event="ViewContent" props={{ content_name: "china", content_category: "authority" }} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          // Article, not NewsArticle: a company page about its own congress
          // appearance, evergreen and with a sales CTA. Google's policies ask for
          // a true representation and the most specific APPLICABLE type.
          "@type": "Article",
          headline: PAGE_TITLE,
          description: PAGE_DESCRIPTION,
          datePublished: CHINA.publishedAt,
          dateModified: CHINA.modifiedAt,
          author: { "@type": "Person", name: "Debora Giovanella", jobTitle: "Fundadora do MedChina" },
          // The Organization node is emitted once, by the layout; reference it.
          publisher: { "@id": `${BRAND.siteUrl}/#organization` },
          ...(photo ? { image: [`${BRAND.siteUrl}${photo.jpeg1200}`, `${BRAND.siteUrl}${photo.src}`] } : {}),
          mainEntityOfPage: `${BRAND.siteUrl}/china`,
          inLanguage: "pt-BR",
        }}
      />

      {/* 1 · Hero */}
      <section className="hero" aria-labelledby="china-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Congresso de Medicina Tradicional Chinesa · Xinjiang, China · {EVENT_MONTH_LABEL}</p>
            <h1 id="china-title">
              O prontuário brasileiro de Medicina Chinesa <em>foi apresentado na China.</em>
            </h1>
            <p className="hero-lead">
              Em janeiro, a acupuntura virou profissão regulamentada no Brasil. {MONTHS_LAW_TO_TALK} depois, a
              plataforma que organiza o registro clínico de acupunturistas brasileiros subiu ao palco de um congresso de
              Medicina Tradicional Chinesa em Xinjiang, na China.
            </p>
            <div className="hero-actions">{cta("hero")}</div>
            <p className="hero-guarantee">
              <CheckCircle size={16} weight="fill" /> A inteligência artificial prepara, você revisa, valida e assina.
            </p>
          </div>

          <div
            className="hero-stage"
            aria-label={
              photo ? "Debora Giovanella no congresso de MTC em Xinjiang" : "MedChina no computador e no celular"
            }
          >
            <div className={`hero-composite ${photo ? "hero-composite--photo" : ""}`}>
              {photo ? (
                <img
                  src={photo.src}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  fetchPriority="high"
                  decoding="async"
                />
              ) : (
                <img
                  src={HERO_IMAGE.src}
                  alt={HERO_IMAGE.alt}
                  width={HERO_IMAGE.width}
                  height={HERO_IMAGE.height}
                  fetchPriority="high"
                  decoding="async"
                />
              )}
            </div>
            <div className="platform-badges">
              <div>
                <MapPin size={21} weight="fill" aria-hidden="true" />
                <span>
                  <small>Congresso de MTC</small>
                  <strong>Xinjiang, China · {EVENT_MONTH_LABEL}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2 · The legal milestone — the first background change */}
      <section className="presence-section" id="marco-legal" aria-labelledby="marco-legal-title">
        <div className="presence-heading">
          <p className="eyebrow eyebrow--light">Sancionada em 12 de janeiro de 2026</p>
          <h2 id="marco-legal-title">
            A acupuntura virou profissão regulamentada. <em>O registro veio junto.</em>
          </h2>
        </div>
        <div className="china-law">
          <div className="china-law-body">
            {/* Precision (docs/PAGINA-CHINA.md §5.2, verified against the
                published text): the law regulates WHO may practise. It has no
                article about records. Everything after the first paragraph is
                "what comes after the law", and must keep saying so. */}
            <p>
              A Lei 15.345 regulamentou o exercício profissional da acupuntura no Brasil. Ela define quem pode exercer:
              graduação em acupuntura, diploma estrangeiro validado, título de especialista reconhecido pelo conselho,
              ou cinco anos ininterruptos de prática até 13 de janeiro de 2026, data de publicação da lei.
            </p>
            <p>
              O que muda no seu consultório não está no texto da lei — está no que vem depois dele. Uma profissão
              regulamentada responde pelo que fez, e responder pelo que fez começa pelo registro do que foi feito. O
              prontuário deixa de ser a agenda pessoal de cada terapeuta e passa a ser o documento da profissão.
            </p>
          </div>
          <aside className="china-law-sources" aria-label="Fontes">
            <h3>Fontes</h3>
            <a href={LAW_SOURCES.text.href} target="_blank" rel="noopener noreferrer">
              <Scales size={18} weight="duotone" aria-hidden="true" /> {LAW_SOURCES.text.label}
            </a>
            <a href={LAW_SOURCES.news.href} target="_blank" rel="noopener noreferrer">
              <ArrowSquareOut size={18} weight="duotone" aria-hidden="true" /> {LAW_SOURCES.news.label}
            </a>
            <p className="china-law-note">
              A lei regulamenta o exercício profissional. Ela não cria uma obrigação específica de prontuário
              eletrônico.
            </p>
          </aside>
        </div>
      </section>

      {/* 3 · What was presented */}
      <section className="section" id="o-que-foi-apresentado" aria-labelledby="apresentado-title">
        <div className="section-heading">
          <p className="eyebrow">O que foi apresentado</p>
          <h2 id="apresentado-title">
            Do prontuário em papel <em>ao prontuário inteligente.</em>
          </h2>
        </div>
        <div className="china-deck">
          <div className="china-deck-copy">
            {/* No slide count here: the public deck leaves out the recorded
                testimony and the previous platform's numbers
                (app/palestra/publica/page.tsx), so "the 23 slides" would promise
                what the link does not show. */}
            <p>
              Os slides que a Debora apresentou no congresso contam a história da medicina chinesa no Brasil, o caminho
              do MedChina e o que a plataforma faz hoje. A apresentação está publicada em português e em chinês.
            </p>
            {/* The slide 19 sentence, as said on stage: a fact of the city, not a
                partnership (docs/PAGINA-CHINA.md §5.6 and §8.5). */}
            <p className="china-deck-context">
              Desde 2019, Goiânia sedia o Instituto Confúcio de Medicina Chinesa, uma parceria entre a Universidade
              Federal de Goiás e a Universidade de Medicina Chinesa de Hebei.
            </p>
          </div>
          <a className="china-deck-card" href="/palestra/publica">
            <span className="china-deck-card-icon">
              <PresentationChart size={28} weight="duotone" aria-hidden="true" />
            </span>
            <strong>Ver a apresentação</strong>
            <small>Os slides do congresso, em português e em chinês.</small>
            <span className="button button--secondary">
              Abrir os slides <ArrowRight size={17} />
            </span>
          </a>
        </div>
        {CHINA.slides.length > 0 ? (
          <div className="china-slides">
            {CHINA.slides.map((slide) => (
              <img
                key={slide.src}
                src={slide.src}
                alt={slide.alt}
                width={slide.width}
                height={slide.height}
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>
        ) : null}
      </section>

      {/* 4 · The endorsement — only with a real, authorized quote */}
      {CHINA.quote ? (
        <section className="section offer-section--tinted" aria-labelledby="endosso-title">
          <div className="section-heading">
            <p className="eyebrow">No congresso</p>
            <h2 id="endosso-title">
              O que disseram <em>na China.</em>
            </h2>
          </div>
          <div className="china-quote">
            <figure>
              <blockquote>&ldquo;{CHINA.quote.text}&rdquo;</blockquote>
              <cite>
                {CHINA.quote.name} · {CHINA.quote.role}
              </cite>
            </figure>
            {CHINA.quote.video ? (
              <video controls preload="none" poster={CHINA.quote.video.poster}>
                <source src={CHINA.quote.video.src} type="video/mp4" />
                <track kind="captions" srcLang="pt-BR" src={CHINA.quote.video.captions} label="Português" default />
              </video>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 5 · The bridge to the product */}
      <section className="section offer-section--tinted" aria-labelledby="ponte-title">
        <div className="section-heading">
          <p className="eyebrow">O que o MedChina faz</p>
          <h2 id="ponte-title">
            O problema nunca foi falta de ficha. <em>Foi digitar enquanto ela falava.</em>
          </h2>
        </div>
        <div className="china-bridge-copy">
          <p>
            Você já registra. Registra há anos — digitando durante a consulta, ou depois dela, à noite, tentando lembrar
            do que foi dito às 14h. O gargalo nunca foi a ausência de um sistema. Foi a atenção dividida entre a
            paciente e o teclado.
          </p>
          <p>
            O MedChina grava a consulta com a autorização da paciente e devolve a anamnese preenchida na estrutura da
            MTC — queixa, sono, digestão, emoções, língua, pulso — com cada campo mostrando o trecho do áudio que o
            originou. O que não foi dito fica em branco: ausência nunca vira negação. Nada é finalizado sem você. A
            inteligência artificial organiza o relato e prepara hipóteses; você revisa, edita, valida e assina.
          </p>
        </div>
        {/* The same fictitious demo the home shows (patient "Helena Martins"):
            the field-state chips are the site's signature motif. */}
        <HomeEvidence copy={homeCopyPtBR.supervised} />
        <div className="china-midcta">{cta("ponte")}</div>
      </section>

      {/* 6 · Who is behind it */}
      <section className="section" aria-labelledby="quem-title">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Quem está por trás</p>
          <h2 id="quem-title">
            Feito por quem <em>atende.</em>
          </h2>
        </div>
        <div className="offer-founder">
          <img
            className="offer-founder-photo"
            src="/images/palestra/fundadora-debora.jpg"
            alt="Retrato de Debora Giovanella, fundadora do MedChina"
            width={963}
            height={963}
            loading="lazy"
            decoding="async"
          />
          <div>
            <h3>Debora Giovanella</h3>
            <p className="offer-founder-role">Fundadora do MedChina · Terapeuta de Medicina Tradicional Chinesa</p>
            <p>
              Terapeuta desde 2017, com formação em shiatsu e em acupuntura, e 25 anos em gestão de marketing e vendas.
              Idealizou o 1º Congresso Práticas da Sabedoria Milenar, em 2020, e conduz a visão clínica do produto.
            </p>
            <p>
              O MedChina nasceu das fichas de papel que ela preenchia no próprio consultório, porque nenhum prontuário
              falava a língua da Medicina Tradicional Chinesa.
            </p>
          </div>
        </div>
      </section>

      {/* 7 · Final CTA */}
      <section className="final-cta" aria-labelledby="final-title">
        <div>
          <p className="eyebrow eyebrow--light">Congresso de MTC · Xinjiang, China</p>
          <h2 id="final-title">
            A medicina é milenar. <em>O registro dela não precisa ser.</em>
          </h2>
          <div className="hero-actions">{cta("final", "button button--light")}</div>
          <ul>
            <li>
              <CheckCircle size={17} weight="fill" /> Você revisa, valida e assina
            </li>
            <li>
              <CheckCircle size={17} weight="fill" /> O que não foi dito fica em branco
            </li>
            <li>
              <CheckCircle size={17} weight="fill" /> Feito para a Medicina Tradicional Chinesa
            </li>
          </ul>
        </div>
      </section>

      {/* 8 · Press — only with the press folder in place */}
      {CHINA.press ? (
        <section className="section china-press" aria-labelledby="imprensa-title">
          <div className="section-heading">
            <p className="eyebrow">Para imprensa</p>
            <h2 id="imprensa-title">Material e contato.</h2>
          </div>
          <p>
            Fotos em alta resolução, release e bio da fundadora:{" "}
            <a href={CHINA.press.folderUrl} target="_blank" rel="noopener noreferrer">
              pasta de imprensa
            </a>
            .
          </p>
          <p>
            <Envelope size={16} weight="duotone" aria-hidden="true" /> Entrevistas:{" "}
            <a href="mailto:contato@medchinaprontuarios.com.br">contato@medchinaprontuarios.com.br</a>
          </p>
          <p>Como citar: MedChina Gestão e Prontuários · CNPJ 38.504.491/0001-80 · Goiânia (GO)</p>
        </section>
      ) : null}
    </main>
  );
}
