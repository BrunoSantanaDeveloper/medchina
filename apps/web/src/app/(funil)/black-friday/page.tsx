import "./black-friday.css";

import { OfferCta, OfferStickyBar } from "../components/offer-cta";
import OfferTestimonials from "../components/offer-testimonials";
import PromoCountdown from "../components/promo-countdown";
import { Metadata } from "next";

import TrackEvent from "@/components/consent/track-event";
import { getSellableCampaign } from "@/lib/campaign-offer-server";
import { campaignQuery, pickCampaignParams } from "@/lib/campaign-params";
import { getGuaranteeDays } from "@/lib/guarantee";
import { HERO_IMAGE } from "@/lib/offer-angles";
import { BRL_WHOLE, type LadderFacts, ladderSentencePtBR } from "@/lib/price-ladder";
import { getPromotion, type Promotion } from "@/lib/promotion";
import { resolveSellablePromotion } from "@/lib/promotion-server";
import {
  ArrowRight,
  CheckCircle,
  FileArrowDown,
  Microphone,
  ShieldCheck,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react/dist/ssr";

const PAGE_TITLE = "Black Friday MedChina";
const PAGE_DESCRIPTION =
  "O Pro do MedChina com preço de Black Friday: grave a consulta com autorização e receba a anamnese organizada na estrutura da MTC, pronta para a sua revisão.";

export const metadata: Metadata = {
  title: { absolute: `${PAGE_TITLE} · O Pro com preço de Black Friday` },
  description: PAGE_DESCRIPTION,
  // A dated price that ranks stops being an offer and becomes a price
  // (docs/FUNIL.md D10): out of the index and out of the sitemap, like every
  // page in (funil). Open Graph stays: the link is shared on WhatsApp.
  robots: { index: false, follow: false },
  openGraph: {
    title: `${PAGE_TITLE} · O Pro com preço de Black Friday`,
    description: PAGE_DESCRIPTION,
    type: "website",
    locale: "pt_BR",
    siteName: "MedChina",
    url: "/black-friday",
  },
  alternates: { canonical: "/black-friday" },
};

// Every number on this page is read at request time from the plan rows and the
// promotion's own dates, so the page and the checkout cannot disagree.
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("pt-BR");
const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
const HOUR = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** "27 de novembro, às 23h59" — the deadline in the words the page prints everywhere. */
const deadlineWords = (iso: string) => {
  const date = new Date(iso);
  const time = HOUR.format(date)
    .replace(":", "h")
    .replace(/^0(\d)h/u, "$1h")
    .replace(/h00$/u, "h");
  return `${DAY_MONTH.format(date)}, ${time.startsWith("0h") || time.startsWith("1h") ? "à" : "às"} ${time}`;
};

const money = (cents: number) => BRL_WHOLE.format(cents / 100);

const DAY = new Intl.DateTimeFormat("pt-BR", { day: "numeric", timeZone: "America/Sao_Paulo" });
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });

/** "de 18 a 27 de novembro" — or "até 27 de novembro" with no start. */
const windowWords = (startIso: string | null, endIso: string) => {
  const end = new Date(endIso);
  if (!startIso) return `até ${DAY_MONTH.format(end)}`;
  const start = new Date(startIso);
  return MONTH.format(start) === MONTH.format(end)
    ? `de ${DAY.format(start)} a ${DAY_MONTH.format(end)}`
    : `de ${DAY_MONTH.format(start)} a ${DAY_MONTH.format(end)}`;
};

/**
 * The Black Friday offer page, built on the Hostinger Black Friday model
 * (conversion-pages skill): the strip and the hero carry the event, the
 * discount, the entry price and the dates; the whole condition sits under the
 * button; the page of always — how it works, what is included, the guarantee,
 * who built it — follows below. What changes from the model, on purpose:
 *
 *  - the dates are WRITTEN beside the counter, which stops at that instant for
 *    everyone (the model's counter had no date);
 *  - the struck price says what it is: the Pro's table price, charged today;
 *  - the product is shown working in the hero, because the person arriving
 *    from an ad may not know MedChina yet;
 *  - the price LADDER is a figure of its own, since "R$ 99" alone is half the
 *    contract (R$ 99 for three months, R$ 197 to the 12th, table price after).
 *
 * Everything commercial is data: the plan row (`pro-black`, with its ladder),
 * the anchor (`pro`) and the window (`platform_settings.promotion`, migration
 * 0126). Outside the window the page says so and sells nothing — the checkout
 * refuses the plan by the same rule (`offerBlock`).
 */
export default async function BlackFridayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, promotion, guaranteeDays] = await Promise.all([searchParams, getPromotion(), getGuaranteeDays()]);
  const sellable = await resolveSellablePromotion(promotion);
  const now = Date.now();

  // The campaign that brought her here rides into the checkout (last touch).
  const campaign = pickCampaignParams(params);
  const checkoutPath = (slug: string) => `/assinatura?plan=${slug}${campaignQuery(campaign)}`;

  if (!sellable) {
    return <ClosedPage promotion={promotion} now={now} />;
  }

  const { plan, facts } = sellable;
  // What the sticky bar says comes next, so the pinned "R$ 99" never reads as
  // the permanent price.
  const secondPriceCents = facts.schedule[1]?.priceCents ?? null;
  const endsAt = sellable.promotion.endsAt as string;
  const checkoutHref = `/auth/sign-up?next=${encodeURIComponent(checkoutPath(plan.slug))}`;
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(checkoutPath(plan.slug))}`;
  const ctaLabel = `Assinar o ${plan.name} na ${sellable.promotion.label}`;
  const sentence = ladderSentencePtBR(facts, plan.period);
  const intro = facts.introCycles ?? 1;
  // The line under the hero button, in the owner's words (2026-11-18). The
  // numbers still come from the plan's ladder; the whole ladder, including
  // the price from the 13th month on, stays in the figure and the FAQ below.
  const heroCondition = secondPriceCents
    ? `${money(facts.firstPriceCents)} nos primeiros ${intro} meses, após ${money(secondPriceCents)} por mês até completar 1 ano no plano ${plan.name}.`
    : sentence;
  const deadline = deadlineWords(endsAt);
  const startWords = sellable.promotion.startsAt ? DAY_MONTH.format(new Date(sellable.promotion.startsAt)) : null;
  const audioMinutes = Number(plan.limits?.audio_minutes ?? 0);
  const hasReasoning = Number(plan.limits?.clinical_reasoning ?? 0) > 0;

  return (
    <main className="clinical-source-home offer-page bf-page">
      <TrackEvent
        event="ViewContent"
        props={{ content_name: "black-friday", content_category: "offer", plan: plan.slug }}
      />

      {/* The strip: the event, the price, the end date and a way to the offer.
          Static on purpose — a looping marquee is motion with no state behind
          it, and the date is the information. */}
      <p className="bf-strip" data-figura="faixa">
        <strong>{sellable.promotion.label} MedChina</strong>
        <span>
          {plan.name} a {money(facts.firstPriceCents)} por mês nos {intro} primeiros meses
        </span>
        <span>Até {deadline}</span>
      </p>

      <section className="bf-hero" aria-labelledby="bf-title" data-figura="topo">
        <div className="bf-hero-inner">
          <div className="bf-hero-copy">
            <p className="bf-event">
              {sellable.promotion.label}
              <span>{windowWords(sellable.promotion.startsAt, endsAt)}</span>
            </p>
            <h1 id="bf-title">
              Termine o dia <em>sem prontuário para escrever.</em>
            </h1>
            <p className="bf-lead">
              Grave a consulta com a autorização da paciente e receba a anamnese organizada na estrutura da Medicina
              Tradicional Chinesa, pronta para a sua revisão.
            </p>

            <div className="bf-offer" id="bf-oferta">
              <div className="bf-offer-top">
                {facts.maxDiscountPercent ? (
                  <span className="bf-pill">
                    {facts.maxDiscountPercent}% OFF <small>nos {intro} primeiros meses</small>
                  </span>
                ) : null}
                {facts.anchorCents ? (
                  <span className="bf-was">
                    <s>{money(facts.anchorCents)}</s> por mês, preço de tabela do {facts.anchorName}
                  </span>
                ) : null}
              </div>
              <p className="bf-price">
                <strong>{money(facts.firstPriceCents)}</strong>
                <span>
                  por mês
                  <small>nos {intro} primeiros meses</small>
                </span>
              </p>
              <OfferCta href={checkoutHref} label={ctaLabel} position="hero" page="black-friday" />
              <p className="bf-condition">
                {heroCondition} Mensal, no cartão ou no PIX, sem fidelidade: você cancela quando quiser pelo painel.
              </p>
              <p className="bf-guarantee">
                <ShieldCheck size={17} weight="fill" aria-hidden="true" /> {guaranteeDays} dias de garantia, com
                reembolso integral
              </p>
              <PromoCountdown
                endsAt={endsAt}
                initialNow={now}
                label={`A condição termina em ${deadline} (horário de Brasília)`}
              />
            </div>
            <p className="offer-signin bf-signin">
              Já tem conta no MedChina? <a href={signInHref}>Entre para concluir</a>.
            </p>
          </div>

          <div className="bf-hero-stage" aria-label="O MedChina em uso">
            <img
              src={HERO_IMAGE.src}
              alt={HERO_IMAGE.alt}
              width={HERO_IMAGE.width}
              height={HERO_IMAGE.height}
              fetchPriority="high"
              decoding="async"
              data-demo
            />
          </div>
        </div>
      </section>

      <section className="section bf-ladder-section" aria-labelledby="bf-ladder-title" data-figura="escada">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">A condição inteira</p>
          <h2 id="bf-ladder-title">
            Quanto você paga <em>em cada mês.</em>
          </h2>
          <p>O valor de cada mês fica decidido no dia em que você assina, e é este.</p>
        </div>
        <LadderFigure facts={facts} />
        {facts.firstYearCents !== null && facts.anchorYearCents && facts.firstYearSavingsCents ? (
          <dl className="bf-year">
            <div>
              <dt>No primeiro ano, nesta condição</dt>
              <dd>{money(facts.firstYearCents)}</dd>
            </div>
            <div>
              <dt>Doze meses no preço de tabela</dt>
              <dd>
                <s>{money(facts.anchorYearCents)}</s>
              </dd>
            </div>
            <div className="bf-year-save">
              <dt>Você deixa de pagar</dt>
              <dd>{money(facts.firstYearSavingsCents)}</dd>
            </div>
          </dl>
        ) : null}
        <div className="offer-midcta">
          <OfferCta href={checkoutHref} label={ctaLabel} position="condicao" page="black-friday" />
        </div>
      </section>

      <section className="section offer-section--tinted">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Como funciona</p>
          <h2>
            Consentimento, anamnese e conduta, <em>com rastreabilidade.</em>
          </h2>
          <p>Telas reais da plataforma, com uma paciente fictícia.</p>
        </div>
        <div className="offer-flow" data-figura="fluxo">
          <figure>
            <img
              src="/images/medchina-flow-consulta-real.webp"
              alt="Tela do MedChina mostrando o início da consulta, com a escolha entre preparar com IA ou somente áudio e o registro do consentimento"
              width={1024}
              height={1024}
              loading="lazy"
              decoding="async"
            />
            <figcaption>
              <strong>1. A consulta começa com contexto e consentimento.</strong> Gravar é uma autorização; preparar a
              anamnese com IA é outra. Sem consentimento, a gravação não começa.
            </figcaption>
          </figure>
          <figure>
            <img
              src="/images/medchina-flow-anamnese-real.webp"
              alt="Tela do MedChina mostrando a anamnese estruturada com campos preenchidos e campos não informados"
              width={1024}
              height={1024}
              loading="lazy"
              decoding="async"
            />
            <figcaption>
              <strong>2. A conversa encontra a estrutura clínica.</strong> Cada campo mostra o trecho que o originou, e
              o que não foi dito fica em branco.
            </figcaption>
          </figure>
          <figure>
            <img
              src="/images/medchina-flow-plano-real.webp"
              alt="Tela do MedChina mostrando o plano terapêutico pronto para revisão e validação"
              width={1024}
              height={1024}
              loading="lazy"
              decoding="async"
            />
            <figcaption>
              <strong>3. Você valida a conduta.</strong> Hipóteses e sugestões chegam preparadas para a sua revisão;
              nada é finalizado sem você.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="section">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">O que está incluso</p>
          <h2>
            É o {plan.name} completo, <em>só o preço é de Black Friday.</em>
          </h2>
        </div>
        <div className="offer-includes" data-figura="inclusos">
          <article>
            <Microphone size={30} weight="duotone" aria-hidden="true" />
            <h3>
              {audioMinutes > 0 ? `${NUMBER.format(audioMinutes)} minutos de áudio por mês` : "Prontuário sem limite"}
            </h3>
            <p>
              A franquia de gravação e transcrição do plano. Pacientes, prontuários e consultas escritas continuam sem
              limite, e há pacotes avulsos de minutos se a franquia acabar.
            </p>
          </article>
          {hasReasoning ? (
            <article>
              <Sparkle size={30} weight="duotone" aria-hidden="true" />
              <h3>Raciocínio clínico</h3>
              <p>
                Hipóteses de padrão explicadas, com sinais favoráveis, contradições e dados ausentes, sempre preparadas
                para a sua revisão e nunca aplicadas sozinhas.
              </p>
            </article>
          ) : null}
          <article>
            <UploadSimple size={30} weight="duotone" aria-hidden="true" />
            <h3>Seus pacientes entram com você</h3>
            <p>
              A importação de pacientes, do histórico de atendimentos e da agenda funciona na plataforma, com
              pré-visualização antes de confirmar e opção de desfazer.
            </p>
          </article>
          <article>
            <FileArrowDown size={30} weight="duotone" aria-hidden="true" />
            <h3>Seus dados, sempre seus</h3>
            <p>
              A exportação completa da sua conta não depende de plano ativo. Se você sair, o prontuário sai com você e
              continua legível.
            </p>
          </article>
        </div>
      </section>

      <OfferTestimonials title="Quem já atende assim" accent="conta o que mudou." />

      <section className="section offer-section--tinted">
        <div className="offer-guarantee" data-figura="garantia">
          <span className="offer-guarantee-icon">
            <ShieldCheck size={34} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <h3>
              {guaranteeDays} dias de <em>garantia</em>
            </h3>
            <p>
              Se não fizer sentido para a sua prática, você pede o reembolso em até {guaranteeDays} dias e recebe o
              valor de volta, sem desconto pelos minutos que já usou. Saindo agora ou daqui a dois anos, o prontuário
              continua legível e a exportação completa não depende de plano ativo.
            </p>
            <a href="/legal/garantia" target="_blank" rel="noopener noreferrer">
              Ler os termos da garantia
            </a>
          </div>
        </div>
        <div className="offer-midcta">
          <OfferCta href={checkoutHref} label={ctaLabel} position="meio" page="black-friday" />
        </div>
      </section>

      <section className="section">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Quem construiu</p>
          <h2>
            Feito por quem <em>atende.</em>
          </h2>
        </div>
        <div className="offer-founder" data-figura="fundadora">
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

      <section className="faq-section section" id="duvidas">
        <div className="faq-intro">
          <p className="eyebrow">Dúvidas</p>
          <h2>Antes de assinar na {sellable.promotion.label}</h2>
          <p>O que muda com o preço desta condição, e o que continua igual.</p>
        </div>
        <div className="faq-list">
          <details open>
            <summary>
              Quanto vou pagar depois dos {intro} primeiros meses?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              {sentence} Os valores já ficam definidos na sua assinatura no dia em que você assina, e avisamos pelo
              painel antes da primeira fatura com o valor novo.
            </p>
          </details>
          <details>
            <summary>
              Tem fidelidade ou multa para cancelar?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. A cobrança é mensal e você cancela quando quiser pelo próprio painel, mantendo o acesso até o fim do
              mês já pago. Dentro dos {guaranteeDays} dias, o reembolso é integral.
            </p>
          </details>
          <details>
            <summary>
              Até quando vale esta condição?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Ela pode ser contratada até {deadline}, horário de Brasília
              {startWords ? `, e vale desde ${startWords}` : ""}. Quem assinar dentro desse prazo fica com estes
              valores, mês a mês, como descritos acima. Depois disso, a assinatura do {plan.name} volta a ser feita
              pelos preços normais.
            </p>
          </details>
          <details>
            <summary>
              Já assino o MedChina. Posso trocar para esta condição?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Pode, e o checkout avisa antes de você pagar: a troca abre uma assinatura nova e encerra a atual na hora,
              sem crédito pelos dias já pagos. Se você está no meio de um período pago, fale com a gente antes.
            </p>
          </details>
          <details>
            <summary>
              Posso usar um cupom junto?
              <span aria-hidden="true">+</span>
            </summary>
            <p>Não. O preço desta condição já é o desconto, e ele não se soma a cupons.</p>
          </details>
          <details>
            <summary>
              A IA decide alguma coisa pela minha paciente?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. Ela organiza o que foi relatado, aponta lacunas e prepara hipóteses para a sua revisão. O que não foi
              informado permanece em branco, ausência nunca vira negação, e nada é finalizado sem a sua validação.
            </p>
          </details>
          <details>
            <summary>
              A paciente precisa autorizar a gravação?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Precisa, e a plataforma registra esse consentimento por finalidade: gravar e usar a IA são autorizações
              separadas, com data e versão do termo. Sem o consentimento, a gravação não começa.
            </p>
          </details>
          <details>
            <summary>
              Já uso outro sistema. Como levo meus pacientes?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              A importação de pacientes, do histórico de atendimentos e da agenda já funciona na plataforma, com
              pré-visualização antes de confirmar e opção de desfazer.
            </p>
          </details>
        </div>
      </section>

      <section className="final-cta" id="bf-final" data-figura="final">
        <div>
          <p className="eyebrow eyebrow--light">
            {sellable.promotion.label} · até {deadline}
          </p>
          <h2>
            {money(facts.firstPriceCents)} por mês nos {intro} primeiros meses.{" "}
            <em>Se não fizer sentido, você tem {guaranteeDays} dias.</em>
          </h2>
          <div className="hero-actions">
            <OfferCta
              href={checkoutHref}
              label={ctaLabel}
              position="final"
              page="black-friday"
              className="button button--light"
            />
          </div>
          <ul>
            <li>
              <CheckCircle size={17} weight="fill" /> {guaranteeDays} dias de garantia
            </li>
            <li>
              <CheckCircle size={17} weight="fill" /> Sem fidelidade, cancele pelo painel
            </li>
            <li>
              <FileArrowDown size={17} weight="fill" /> Seus dados exportáveis a qualquer momento
            </li>
          </ul>
        </div>
      </section>

      <OfferStickyBar watchId="bf-oferta" hideOnId="bf-final">
        <span className="bf-sticky-price">
          <span>
            <strong>{money(facts.firstPriceCents)}</strong> por mês
          </span>
          <small>
            nos {intro} primeiros meses
            {secondPriceCents ? ` · depois, ${money(secondPriceCents)}/mês` : ""}
          </small>
        </span>
        <OfferCta
          href={checkoutHref}
          label={ctaLabel}
          position="barra"
          page="black-friday"
          className="button button--sm"
        />
      </OfferStickyBar>
    </main>
  );
}

/**
 * The ladder as a figure: one column per month of the first year, as tall as
 * what that month costs, against the table price drawn as a line, and the
 * thirteenth month onward as an open-ended column. Read without words, it
 * says: cheap at first, then more, never above the table price.
 */
function LadderFigure({ facts }: { facts: LadderFacts }) {
  const top = Math.max(facts.anchorCents ?? 0, ...facts.schedule.map((stretch) => stretch.priceCents));
  const months = Array.from({ length: 12 }, (_, index) => {
    const cycle = index + 1;
    const stretch =
      facts.schedule.find((item) => cycle >= item.fromCycle && (item.toCycle === null || cycle <= item.toCycle)) ??
      facts.schedule[facts.schedule.length - 1];
    return { cycle, priceCents: stretch.priceCents, step: facts.schedule.indexOf(stretch) };
  });
  const after = facts.schedule.find((stretch) => stretch.toCycle === null && stretch.fromCycle > 12) ?? null;
  const ratio = (cents: number) => Math.min(1, cents / top).toFixed(4);
  const pct = (cents: number) => `${Math.max(6, Math.round((cents / top) * 100))}%`;

  return (
    <figure className="bf-ladder" aria-labelledby="bf-ladder-caption">
      <div
        className="bf-ladder-chart"
        role="img"
        aria-label={facts.schedule
          .map(
            (s) =>
              `${s.toCycle === null ? `do mês ${s.fromCycle} em diante` : `meses ${s.fromCycle} a ${s.toCycle}`}: ${money(s.priceCents)}`,
          )
          .join("; ")}
      >
        {facts.anchorCents ? (
          <span
            className="bf-ladder-anchor"
            style={{ bottom: `calc(30px + (100% - 60px) * ${ratio(facts.anchorCents)})` }}
          >
            <span>Tabela: {money(facts.anchorCents)}</span>
          </span>
        ) : null}
        {months.map((month) => (
          <span
            key={month.cycle}
            className={`bf-ladder-bar bf-ladder-bar--${month.step}`}
            style={{ height: pct(month.priceCents) }}
          >
            <small>{month.cycle}º</small>
          </span>
        ))}
        {after ? (
          <span className="bf-ladder-bar bf-ladder-bar--after" style={{ height: pct(after.priceCents) }}>
            <small>13º+</small>
          </span>
        ) : null}
      </div>
      <figcaption id="bf-ladder-caption" className="bf-ladder-legend">
        {facts.schedule.map((stretch, index) => (
          <span
            key={stretch.fromCycle}
            className={`bf-ladder-key bf-ladder-key--${stretch.toCycle === null && stretch.fromCycle > 12 ? "after" : index}`}
          >
            <strong>{money(stretch.priceCents)}</strong>
            <small>
              {stretch.toCycle === null
                ? `por mês, do ${stretch.fromCycle}º mês em diante${facts.endsAtAnchor ? " (preço de tabela)" : ""}`
                : stretch.fromCycle === 1
                  ? `por mês, do 1º ao ${stretch.toCycle}º mês`
                  : `por mês, do ${stretch.fromCycle}º ao ${stretch.toCycle}º mês`}
            </small>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Before the start, after the end, switched off or misconfigured: the page
 * says which, sells nothing, and offers the one honest way forward.
 */
async function ClosedPage({ promotion, now }: { promotion: Promotion | null; now: number }) {
  const label = promotion?.label ?? "Black Friday";
  const notStarted = promotion?.reason === "not_started" && promotion.startsAt;
  // After the promotion, the paid campaign may still be open on /assinar —
  // a real, current price, not a consolation invented here.
  const campaign = notStarted ? null : await getSellableCampaign();

  return (
    <main className="clinical-source-home offer-page bf-page">
      <section className="bf-hero bf-hero--closed" aria-labelledby="bf-title">
        <div className="bf-hero-inner">
          <div className="bf-hero-copy">
            <p className="bf-event">{label}</p>
            <h1 id="bf-title">
              {notStarted ? (
                <>
                  A {label} do MedChina <em>começa em {DAY_MONTH.format(new Date(promotion.startsAt as string))}.</em>
                </>
              ) : promotion?.reason === "expired" ? (
                <>
                  A {label} do MedChina <em>terminou.</em>
                </>
              ) : (
                <>
                  Esta condição <em>não está aberta no momento.</em>
                </>
              )}
            </h1>
            {notStarted ? (
              <>
                <p className="bf-lead">
                  Ela abre em {deadlineWords(promotion.startsAt as string)}, horário de Brasília. Até lá, este preço não
                  pode ser contratado.
                </p>
                <PromoCountdown endsAt={promotion.startsAt as string} initialNow={now} label="Abre em" />
              </>
            ) : (
              <p className="bf-lead">
                {campaign
                  ? `O ${campaign.plan.name} continua disponível na condição atual da campanha.`
                  : "Se você chegou por um anúncio e queria assinar, fale com a gente: resolvemos antes que você assine qualquer outra coisa."}
              </p>
            )}
            <div className="hero-actions">
              {campaign ? (
                <a className="button button--light" href="/assinar">
                  Ver a condição atual <ArrowRight size={18} aria-hidden="true" />
                </a>
              ) : (
                <a className="button button--light" href="/contato?assunto=black-friday">
                  Falar com a gente <ArrowRight size={18} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
          <div className="bf-hero-stage" aria-label="O MedChina em uso">
            <img
              src={HERO_IMAGE.src}
              alt={HERO_IMAGE.alt}
              width={HERO_IMAGE.width}
              height={HERO_IMAGE.height}
              decoding="async"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
