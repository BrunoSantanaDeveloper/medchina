import { Metadata } from "next";

import TrackEvent from "@/components/consent/track-event";
import { getCampaignOffer } from "@/lib/campaign-offer";
import { getGuaranteeDays } from "@/lib/guarantee";
import { HERO_IMAGE, OFFER_ANGLES, resolveAngle } from "@/lib/offer-angles";
import { getPlanBySlug } from "@flyee/billing/public";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  FileArrowDown,
  Microphone,
  ShieldCheck,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react/dist/ssr";

const PAGE_TITLE = "Assine o MedChina";
const PAGE_DESCRIPTION =
  "Grave a consulta com a autorização da paciente e receba a anamnese preenchida na estrutura da Medicina Tradicional Chinesa, pronta para a sua revisão.";

export const metadata: Metadata = {
  // `absolute` because the root layout appends "| MedChina" to every title.
  title: { absolute: `${PAGE_TITLE} · MedChina` },
  description: PAGE_DESCRIPTION,
  // Out of the index and out of the sitemap (docs/FUNIL.md D10): the page that
  // should rank for price is `/planos`. This one changes headline per campaign
  // and must not compete with itself. Open Graph is a separate decision — the
  // link is shared, and messengers ignore robots.
  robots: { index: false, follow: false },
  openGraph: {
    title: `${PAGE_TITLE} · MedChina`,
    description: PAGE_DESCRIPTION,
    type: "website",
    locale: "pt_BR",
    siteName: "MedChina",
    url: "/assinar",
  },
  twitter: { card: "summary_large_image", title: `${PAGE_TITLE} · MedChina`, description: PAGE_DESCRIPTION },
  alternates: { canonical: "/assinar" },
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("pt-BR");

/** Brazil sells in one timezone; the server runs in UTC. */
const DEADLINE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const PERIOD_SUFFIX: Record<string, string> = { yearly: "por ano", monthly: "por mês", weekly: "por semana" };
const PERIOD_EVERY: Record<string, string> = { yearly: "a cada ano", monthly: "a cada mês", weekly: "a cada semana" };

/**
 * The landing page for paid traffic.
 *
 * What it is NOT: the home (trial-first by design — every button there opens a
 * free account, which the commercial plan forbids optimizing for) and not
 * `/fundadores` (a warm-audience condition with real seats and an onboarding
 * call behind each one). This page has a single job: sell the plan the running
 * campaign announces, to someone who has never heard of us.
 *
 * Everything commercial is DATA, read at request time:
 *
 *  - which plan is on sale, which plan anchors its price, and until when come
 *    from `platform_settings.campaign_offer` (one console, `/admin/billing`);
 *  - the price, the period and the audio quota come from the plan row;
 *  - the guarantee comes from `platform_settings.guarantee`.
 *
 * So a new campaign is a settings change, not a deploy — and the deadline the
 * page prints is the same one the checkout enforces (`startCheckout`), which is
 * what keeps the scarcity honest (docs/FUNIL.md: "nada de escassez falsa").
 *
 * The hero changes with the ad that produced the click (`lib/offer-angles.ts`);
 * everything below it is the same for every angle.
 */
export default async function AssinarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, offer, guaranteeDays] = await Promise.all([searchParams, getCampaignOffer(), getGuaranteeDays()]);
  const angleSlug = resolveAngle(params.utm_content);
  const angle = OFFER_ANGLES[angleSlug];

  const plan = offer?.planSlug ? await getPlanBySlug(offer.planSlug) : null;
  const comparePlan = offer?.comparePlanSlug ? await getPlanBySlug(offer.comparePlanSlug) : null;
  const open = Boolean(offer && !offer.closed && plan);

  const nextAfterAuth = plan ? `/settings/billing?plan=${plan.slug}` : null;
  const checkoutHref = nextAfterAuth ? `/auth/sign-up?next=${encodeURIComponent(nextAfterAuth)}` : "/contato";
  // Part of this audience already has an account from the card-less trial, and
  // signing up again lands on "confirme seu e-mail" for a message that never
  // arrives. The way back in belongs on the page.
  const signInHref = nextAfterAuth ? `/auth/sign-in?next=${encodeURIComponent(nextAfterAuth)}` : null;

  const periodSuffix = plan?.period ? (PERIOD_SUFFIX[plan.period] ?? "") : "";
  const periodEvery = plan?.period ? (PERIOD_EVERY[plan.period] ?? "a cada ciclo") : "a cada ciclo";

  // The anchor is a REAL catalogue price. A monthly table price anchoring a
  // yearly offer is annualized and said out loud; anything else would be a
  // struck price nobody was ever charged.
  const anchorCents =
    comparePlan && plan
      ? comparePlan.period === "monthly" && plan.period === "yearly"
        ? comparePlan.priceCents * 12
        : comparePlan.period === plan.period
          ? comparePlan.priceCents
          : 0
      : 0;
  const anchorNote =
    comparePlan && anchorCents > 0 && comparePlan.period === "monthly" && plan?.period === "yearly"
      ? `Preço de tabela do ${comparePlan.name}: 12 × ${BRL.format(comparePlan.priceCents / 100)} por mês.`
      : comparePlan && anchorCents > 0
        ? `Preço de tabela do ${comparePlan.name}.`
        : null;
  const savings =
    plan && anchorCents > plan.priceCents ? Math.round(((anchorCents - plan.priceCents) / anchorCents) * 100) : null;

  const monthlyEquivalentCents = plan && plan.period === "yearly" ? Math.round(plan.priceCents / 12) : null;

  // An `audio_minutes` limit is spent over one billing cycle
  // (`org_audio_allowance`, migration 0024), so it is printed with the plan's
  // own period — the only thing that keeps a yearly line from being sold as if
  // it carried a monthly quota.
  const audioMinutes = plan?.limits?.audio_minutes ?? 0;
  const audioSuffix = plan?.period ? (PERIOD_SUFFIX[plan.period] ?? "por ciclo") : "por ciclo";
  const hasReasoning = (plan?.limits?.clinical_reasoning ?? 0) > 0;

  const deadlineLabel = offer?.deadline ? DEADLINE_FORMAT.format(new Date(offer.deadline)) : null;

  return (
    <main className="clinical-source-home offer-page">
      {/* The page paid traffic lands on has to be distinguishable from an
          ordinary visit, or the remarketing audience is everyone. */}
      <TrackEvent
        event="ViewContent"
        props={{ content_name: "assinar", content_category: "offer", angle: angleSlug }}
      />

      <section className="hero" aria-labelledby="assinar-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">{angle.eyebrow}</p>
            <h1 id="assinar-title">
              {angle.title} <em>{angle.accent}</em>
            </h1>
            <p className="hero-lead">{angle.lead}</p>

            {open && plan ? (
              <>
                <div className="offer-price">
                  {savings ? (
                    <p className="offer-price-was">
                      <s>
                        {BRL.format(anchorCents / 100)}
                        {periodSuffix ? `/${periodSuffix.replace("por ", "")}` : ""}
                      </s>
                      <span className="offer-price-badge">{savings}% de economia</span>
                    </p>
                  ) : null}
                  <p className="offer-price-now">
                    <strong>{BRL.format(plan.priceCents / 100)}</strong>
                    <small>{periodSuffix}</small>
                  </p>
                  {monthlyEquivalentCents ? (
                    <p className="offer-price-note">
                      Equivale a {BRL.format(monthlyEquivalentCents / 100)} por mês, em um pagamento anual único.
                    </p>
                  ) : null}
                  {anchorNote ? <p className="offer-price-note">{anchorNote}</p> : null}
                </div>
                <div className="hero-actions">
                  <a className="button" href={checkoutHref}>
                    Assinar o {plan.name} <ArrowRight size={18} />
                  </a>
                </div>
                <p className="hero-guarantee">
                  <CheckCircle size={16} weight="fill" /> {guaranteeDays} dias de garantia · PIX, boleto ou cartão ·
                  cancele pelo painel
                </p>
                {deadlineLabel ? (
                  <p className="offer-price-note offer-deadline">
                    Esta condição vale até {deadlineLabel}, horário de Brasília.
                  </p>
                ) : null}
                {signInHref ? (
                  <p className="offer-signin">
                    Já tem conta no MedChina? <a href={signInHref}>Entre para concluir</a>.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="offer-closed">
                <h2>
                  {offer?.reason === "expired"
                    ? "O prazo desta condição terminou"
                    : "Esta condição não está aberta no momento"}
                </h2>
                <p>
                  Se você chegou por um anúncio e queria assinar, fale com a gente — resolvemos antes que você assine
                  qualquer outra coisa.
                </p>
                <a className="button" href="/contato?assunto=assinar">
                  Falar com a gente <ArrowRight size={17} />
                </a>
              </div>
            )}
          </div>

          <div className="hero-stage" aria-label="MedChina em uso">
            <div className="hero-composite">
              <img
                src={HERO_IMAGE.src}
                alt={HERO_IMAGE.alt}
                width={HERO_IMAGE.width}
                height={HERO_IMAGE.height}
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section offer-section--tinted">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Você reconhece?</p>
          <h2>
            A consulta não deveria acontecer <em>entre você e uma tela.</em>
          </h2>
        </div>
        <div className="offer-includes">
          <article>
            <Clock size={30} weight="duotone" aria-hidden="true" />
            <h3>Digitar enquanto ela fala</h3>
            <p>
              Anotar durante o atendimento custa o contato visual, e é justamente olhar, ouvir e observar que a sua
              prática exige.
            </p>
          </article>
          <article>
            <FileArrowDown size={30} weight="duotone" aria-hidden="true" />
            <h3>Reconstruir a consulta à noite</h3>
            <p>
              O registro feito horas depois perde detalhe, e o detalhe é o que sustenta a comparação com a próxima
              consulta.
            </p>
          </article>
          <article>
            <Sparkle size={30} weight="duotone" aria-hidden="true" />
            <h3>Um prontuário emprestado</h3>
            <p>
              Sistemas genéricos não têm anamnese energética, língua, pulso, pontos nem padrões. Você adapta o seu
              raciocínio ao formulário de outra medicina.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Como funciona</p>
          <h2>
            Consentimento, anamnese e conduta, <em>com rastreabilidade.</em>
          </h2>
          <p>Telas reais da plataforma, com uma paciente fictícia.</p>
        </div>
        <div className="offer-flow">
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

      {open && plan ? (
        <section className="section offer-section--tinted">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">O que está incluso</p>
            <h2>
              Tudo o que o {plan.name} tem, <em>pelo preço desta condição.</em>
            </h2>
          </div>
          <div className="offer-includes">
            <article>
              <Microphone size={30} weight="duotone" aria-hidden="true" />
              <h3>
                {audioMinutes > 0
                  ? `${NUMBER.format(audioMinutes)} minutos de áudio ${audioSuffix}`
                  : "Prontuário sem limite"}
              </h3>
              <p>
                {audioMinutes > 0
                  ? "A franquia de gravação e transcrição do plano. Cadastro de pacientes, prontuário e consultas escritas continuam sem limite, e há pacotes avulsos quando a franquia acaba."
                  : "Pacientes, prontuários e consultas escritas sem limite."}
              </p>
            </article>
            {hasReasoning ? (
              <article>
                <Sparkle size={30} weight="duotone" aria-hidden="true" />
                <h3>Raciocínio clínico</h3>
                <p>
                  Hipóteses de padrão explicadas, com sinais favoráveis, contradições e dados ausentes — sempre
                  preparadas para a sua revisão, nunca aplicadas sozinhas.
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
      ) : null}

      <section className="section">
        {/* Same visual weight as the price, on purpose: the objection here is not
            the amount, it is what happens to her records if she leaves. */}
        <div className="offer-guarantee">
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
        {open && plan ? (
          <div className="offer-midcta">
            <a className="button" href={checkoutHref}>
              Assinar o {plan.name} <ArrowRight size={18} />
            </a>
          </div>
        ) : null}
      </section>

      <section className="section offer-section--tinted">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Quem construiu</p>
          <h2>
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

      {open && plan ? (
        <section className="section">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">Depois de clicar</p>
            <h2>
              Três passos, e o plano <em>está ativo.</em>
            </h2>
            <p>Por PIX a ativação leva minutos. Por boleto, alguns dias úteis.</p>
          </div>
          <ol className="offer-steps">
            <li>
              <span aria-hidden="true">1</span>
              <div>
                <h3>Crie sua conta</h3>
                <p>Nome, e-mail e senha. Você confirma o e-mail pelo link que chega na sua caixa.</p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">2</span>
              <div>
                <h3>Informe CPF ou CNPJ</h3>
                <p>É o dado fiscal que a operadora de pagamento exige para emitir a sua fatura.</p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">3</span>
              <div>
                <h3>Pague a fatura</h3>
                <p>PIX, boleto ou cartão, na própria fatura. Confirmado o pagamento, o plano ativa sozinho.</p>
              </div>
            </li>
          </ol>
        </section>
      ) : null}

      <section className="faq-section section" id="duvidas">
        <div className="faq-intro">
          <p className="eyebrow">Dúvidas</p>
          <h2>Antes de assinar</h2>
          <p>As perguntas que aparecem em toda conversa sobre a plataforma.</p>
        </div>
        <div className="faq-list">
          <details open>
            <summary>
              Preciso gravar todas as consultas?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. O prontuário funciona escrito, sem gravar nada, e sem limite de pacientes ou consultas. A gravação é
              uma escolha sua, consulta a consulta, e é ela que consome a franquia de minutos.
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
              A IA decide alguma coisa pela minha paciente?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. Ela organiza o que foi relatado, aponta lacunas e prepara hipóteses para a sua revisão. O que não foi
              informado permanece em branco — ausência nunca vira negação — e nada é finalizado sem a sua validação.
            </p>
          </details>
          <details>
            <summary>
              Serve só para acupuntura?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. O prontuário acompanha o raciocínio da Medicina Tradicional Chinesa e as técnicas que você já usa:
              acupuntura, auriculoterapia, moxabustão, ventosa e dietoterapia chinesa.
            </p>
          </details>
          <details>
            <summary>
              Como funciona a cobrança e o cancelamento?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              A assinatura é renovada {periodEvery}, por PIX, boleto ou cartão, e você cancela quando quiser pelo
              próprio painel, mantendo o acesso até o fim do período já pago. Dentro dos {guaranteeDays} dias, o
              reembolso é integral.
            </p>
          </details>
          {audioMinutes > 0 ? (
            <details>
              <summary>
                E quando os minutos acabarem?
                <span aria-hidden="true">+</span>
              </summary>
              <p>
                O plano inclui {NUMBER.format(audioMinutes)} minutos de áudio {audioSuffix}. Quando a franquia acaba, o
                prontuário, a agenda e as consultas escritas seguem funcionando, e você pode comprar um pacote avulso de
                minutos pelo painel.
              </p>
            </details>
          ) : null}
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
          <details>
            <summary>
              O aplicativo substitui a plataforma web?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não, ele é complementar: grava o áudio da consulta, aceita observações por voz e mostra o status do
              processamento. A revisão da anamnese e os planos ficam na web.
            </p>
          </details>
          <details>
            <summary>
              Posso testar antes?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Existe um plano gratuito, sem gravação, e um período de teste do Pro sem cartão que começa na sua primeira
              ação de trabalho. Esta página é sobre o plano com gravação e IA: se você assinar hoje, os {guaranteeDays}{" "}
              dias de garantia cobrem a decisão.
            </p>
          </details>
          <details>
            <summary>
              O que acontece com os dados das minhas pacientes?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Você é a controladora dos dados das suas pacientes; a plataforma os trata como operadora, seguindo as suas
              instruções. Consentimento separado por finalidade, registro de acesso e histórico de alterações.
              Informações clínicas não são usadas para treinar modelos de terceiros.
            </p>
          </details>
        </div>
      </section>

      {open && plan ? (
        <section className="final-cta">
          <div>
            <p className="eyebrow eyebrow--light">Seu próximo atendimento pode começar diferente</p>
            <h2>
              Assine hoje. <em>Se não fizer sentido, você tem {guaranteeDays} dias.</em>
            </h2>
            <div className="hero-actions">
              <a className="button button--light" href={checkoutHref}>
                Assinar o {plan.name} <ArrowRight size={18} />
              </a>
            </div>
            <ul>
              <li>
                <CheckCircle size={17} weight="fill" /> {guaranteeDays} dias de garantia
              </li>
              <li>
                <CheckCircle size={17} weight="fill" /> Cancele pelo painel, sem ligação
              </li>
              <li>
                <FileArrowDown size={17} weight="fill" /> Seus dados exportáveis a qualquer momento
              </li>
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}
