import "./fundadores.css";

import { Metadata } from "next";

import TrackEvent from "@/components/consent/track-event";
import { getFoundersOffer } from "@/lib/founders-offer";
import { getGuaranteeDays } from "@/lib/guarantee";
import { getPlanBySlug } from "@flyee/billing/public";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Headset,
  Microphone,
  Notebook,
  ShieldCheck,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react/dist/ssr";

const OFFER_TITLE = "Condição de fundadora";
const OFFER_DESCRIPTION =
  "Acesso completo ao MedChina Pro pelo preço anual do Assistente, com o valor travado enquanto a assinatura durar, para uma turma limitada de profissionais de Medicina Tradicional Chinesa.";

export const metadata: Metadata = {
  // `absolute` on purpose: the root layout applies a `%s | MedChina` template,
  // and a title that already carries the brand came out as
  // "Condição de fundadora — MedChina | MedChina" in the shared link preview.
  title: { absolute: `${OFFER_TITLE} · MedChina` },
  description: OFFER_DESCRIPTION,
  // Deliberately out of the index AND out of the sitemap (docs/FUNIL.md D10):
  // this is a private condition sent to a specific audience, and a price that
  // ranks on Google is no longer a limited offer — it is the price.
  robots: { index: false, follow: false },
  // Open Graph is NOT the same decision as indexing. The first wave is the
  // founder's own WhatsApp, so the link preview is the first thing anyone sees
  // of this offer; messengers read these tags and ignore robots. The image
  // itself comes from `opengraph-image.tsx` next to this file, by convention.
  openGraph: {
    title: `${OFFER_TITLE} · MedChina`,
    description: OFFER_DESCRIPTION,
    type: "website",
    locale: "pt_BR",
    siteName: "MedChina",
    url: "/fundadores",
  },
  twitter: { card: "summary_large_image", title: `${OFFER_TITLE} · MedChina`, description: OFFER_DESCRIPTION },
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("pt-BR");

/** Brazil sells and settles in one timezone; the server runs in UTC. */
const DEADLINE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** How the plan's own billing period reads next to a quota. */
const PERIOD_LABEL: Record<string, string> = { yearly: "por ano", monthly: "por mês", weekly: "por semana" };

/**
 * The founders offer page.
 *
 * Built in the Landing DS (docs/DESIGN.md) — the class vocabulary of
 * `clinical-source-home.css`, direct Phosphor icons, hardcoded pt-BR — because
 * someone who arrives here from a call or a QR code at an event must land on
 * something that looks like the MedChina she will see next.
 *
 * Two rules govern what it may say, both blocking:
 *
 *  - **Every number is real.** Seats, deadline, price and the audio quota come
 *    from `founders_offer()` and the plan row (migrations 0085/0087) — the SAME
 *    call that refuses the checkout when they run out. No decay timer, no
 *    "restam poucas". This is sold inside a small professional community where
 *    the founder's reputation is the asset (docs/FUNIL.md).
 *  - **No fabricated proof.** The plan asks for three testimonials with name,
 *    photo and city; there are none yet, and HOME-SPEC §33.5 forbids inventing
 *    them. So the page ships without that block rather than with a fake one —
 *    it gets added once the first founders give real ones (T4.4). What stands
 *    in its place is the one piece of proof that IS real today: who is on the
 *    other side of the call, with the credentials already published in the
 *    congress deck (`components/presentation/slides-data.ts`).
 *
 * And one structural rule: there is no path from here to the free plan. The
 * layout drops the site menu; every CTA on the page goes to the same place.
 */
export default async function FundadoresPage() {
  const [offer, guaranteeDays] = await Promise.all([getFoundersOffer(), getGuaranteeDays()]);
  const plan = offer?.planSlug ? await getPlanBySlug(offer.planSlug) : null;
  const comparePlan = offer?.comparePlanSlug ? await getPlanBySlug(offer.comparePlanSlug) : null;

  const open = Boolean(offer && !offer.closed && plan);
  // The checkout link carries the plan through sign-up: `?next=` survives the
  // e-mail confirmation, so she lands on the offer already selected.
  const nextAfterAuth = plan ? `/settings/billing?plan=${plan.slug}` : null;
  const checkoutHref = nextAfterAuth ? `/auth/sign-up?next=${encodeURIComponent(nextAfterAuth)}` : "/contato";
  // Much of the first wave already has an account (the card-less Pro trial), and
  // signing up again lands on "check your e-mail" for a message that will never
  // arrive. The way back in has to be visible on the page, not buried in the
  // footer of the sign-up form.
  const signInHref = nextAfterAuth ? `/auth/sign-in?next=${encodeURIComponent(nextAfterAuth)}` : null;

  // The anchor is a REAL catalogue price, normalized to the offer's period so a
  // monthly table price can still anchor a yearly offer — stated as such,
  // never as a yearly price nobody was ever charged.
  const anchorCents =
    comparePlan && plan
      ? comparePlan.period === "monthly" && plan.period === "yearly"
        ? comparePlan.priceCents * 12
        : comparePlan.period === plan.period
          ? comparePlan.priceCents
          : 0
      : 0;
  const anchorNote =
    comparePlan && anchorCents > 0 && comparePlan.period === "monthly"
      ? `Preço de tabela do ${comparePlan.name}: 12 × ${BRL.format(comparePlan.priceCents / 100)} por mês.`
      : null;
  const savings =
    plan && anchorCents > plan.priceCents ? Math.round(((anchorCents - plan.priceCents) / anchorCents) * 100) : null;

  // Independent of the anchor above, which needs a plan slug someone had to
  // configure: the monthly equivalent is arithmetic on the offer's own price,
  // so the page always carries at least one way to read R$ 1.990.
  const monthlyEquivalentCents = plan && plan.period === "yearly" ? Math.round(plan.priceCents / 12) : null;

  // The commercial fact the page used to omit entirely. It is rendered with the
  // plan's OWN period: an `audio_minutes` limit is spent over one billing cycle
  // (`org_audio_allowance`, migration 0024), so on a yearly line it is a yearly
  // quota — and printing it here is what keeps a misconfigured plan from being
  // sold as "the complete Pro".
  const audioMinutes = plan?.limits?.audio_minutes ?? 0;
  const audioPeriodLabel = plan?.period ? (PERIOD_LABEL[plan.period] ?? "por ciclo") : "por ciclo";

  const deadlineLabel = offer?.deadline ? DEADLINE_FORMAT.format(new Date(offer.deadline)) : null;

  return (
    <main className="clinical-source-home offer-page">
      {/* The highest-intent page on the site used to be the only one with no
          event of its own — remarketing could not tell "saw the offer" from
          "visited the site". */}
      <TrackEvent event="ViewContent" props={{ content_name: "fundadores", content_category: "offer" }} />

      <section className="hero" aria-labelledby="oferta-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Condição de fundadora</p>
            <h1 id="oferta-title">
              O MedChina Pro completo,
              <br />
              pelo preço do <em>Assistente.</em>
            </h1>
            <p className="hero-lead">
              Um número limitado de profissionais entra agora com acesso ao raciocínio clínico supervisionado, migração
              acompanhada e preço travado enquanto a assinatura durar.
            </p>

            {open && plan ? (
              <>
                <div className="offer-price">
                  {savings ? (
                    <p className="offer-price-was">
                      <s>{BRL.format(anchorCents / 100)}/ano</s>
                      <span className="offer-price-badge">{savings}% de economia</span>
                    </p>
                  ) : null}
                  <p className="offer-price-now">
                    <strong>{BRL.format(plan.priceCents / 100)}</strong>
                    <small>{plan.period === "yearly" ? "por ano" : "por mês"}</small>
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
                    Garantir minha vaga <ArrowRight size={18} />
                  </a>
                </div>
                <p className="hero-guarantee">
                  <CheckCircle size={16} weight="fill" /> {guaranteeDays} dias de garantia · pagamento por PIX, boleto
                  ou cartão
                </p>
                {signInHref ? (
                  <p className="offer-signin">
                    Já tem conta no MedChina? <a href={signInHref}>Entre para concluir</a>.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="offer-closed">
                <h2>
                  {offer?.reason === "sold_out"
                    ? "As vagas desta turma acabaram"
                    : offer?.reason === "expired"
                      ? "O prazo desta condição terminou"
                      : "A condição de fundadora não está aberta no momento"}
                </h2>
                <p>
                  Se você recebeu este link e não conseguiu concluir, fale com a gente — queremos resolver antes que
                  você assine qualquer outra coisa.
                </p>
                <a className="button" href="/contato?assunto=fundadores">
                  Falar com a gente <ArrowRight size={17} />
                </a>
              </div>
            )}
          </div>

          <div className="hero-stage" aria-label="MedChina no computador e no celular">
            <div className="hero-composite">
              <img
                src="/images/medchina-hero-product-composite.webp"
                alt="Profissional de Medicina Tradicional Chinesa usando o MedChina no computador e no celular"
                width={1024}
                height={1536}
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </div>
        </div>
      </section>

      {open && offer ? (
        <section className="section offer-section--tinted">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">Quantas restam</p>
            <h2>
              A turma de fundadoras é <em>pequena de propósito.</em>
            </h2>
            <p>
              Cada fundadora recebe migração acompanhada e onboarding individual com Debora Giovanella, que conduz a
              visão clínica do MedChina. É esse limite de agenda — não uma tática de venda — que define o número de
              vagas.
            </p>
          </div>
          {/* Every figure below is a live count of subscriptions on the offer
              plan, from the same function that stops the checkout. */}
          <div className={`offer-seats ${offer.seatsLeft <= 0 ? "offer-seats--closed" : ""}`}>
            <p className="offer-seats-count">
              {offer.seatsLeft <= 0
                ? "Vagas esgotadas"
                : offer.seatsTaken === 0
                  ? `${offer.seatsTotal} vagas nesta turma`
                  : `${offer.seatsLeft} de ${offer.seatsTotal} vagas disponíveis`}
            </p>
            {/* An empty bar on opening day reads as "nobody bought this". The
                count is the honest signal until there is progress to show. */}
            {offer.seatsTaken > 0 ? (
              <div
                className="offer-seats-track"
                role="progressbar"
                aria-valuenow={offer.seatsTaken}
                aria-valuemin={0}
                aria-valuemax={offer.seatsTotal}
                aria-label={`${offer.seatsTaken} de ${offer.seatsTotal} vagas preenchidas`}
              >
                <div
                  className="offer-seats-fill"
                  style={{
                    width: `${offer.seatsTotal > 0 ? Math.min(100, Math.round((offer.seatsTaken / offer.seatsTotal) * 100)) : 0}%`,
                  }}
                />
              </div>
            ) : null}
            {deadlineLabel ? (
              <p className="offer-seats-note">Ou até {deadlineLabel}, horário de Brasília, o que vier primeiro.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The only proof this page is allowed to carry today. Testimonials need
          real names, photos and consent (T2.4/T4.4); this does not — every line
          below is already published in the congress deck. */}
      <section className="section">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Quem está do outro lado</p>
          <h2>
            Você entra acompanhada por <em>quem atende.</em>
          </h2>
        </div>
        <div className="offer-founder">
          {/* The photograph landed in the repository with the congress deck; the
              monogram it replaces was a placeholder for proof that now exists. */}
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
              A chamada de onboarding de cada fundadora é com ela. É por isso que a turma tem o tamanho que a agenda
              dela comporta.
            </p>
          </div>
        </div>
      </section>

      <section className="section offer-section--tinted">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">O que a condição inclui</p>
          <h2>
            Preço do Assistente, acesso do Pro, <em>migração feita junto.</em>
          </h2>
        </div>
        <div className="offer-includes">
          <article>
            <Sparkle size={30} weight="duotone" aria-hidden="true" />
            <h3>Raciocínio clínico do Pro</h3>
            <p>
              Hipóteses de padrão explicadas, com sinais favoráveis, contradições e dados ausentes — sempre preparadas
              para a sua revisão, nunca aplicadas sozinhas. É o recurso que separa o Pro do Assistente, e ele entra na
              condição.
            </p>
          </article>
          <article>
            <Microphone size={30} weight="duotone" aria-hidden="true" />
            <h3>
              {audioMinutes > 0 ? `${NUMBER.format(audioMinutes)} minutos de áudio ${audioPeriodLabel}` : "Uso manual"}
            </h3>
            <p>
              {audioMinutes > 0
                ? "A franquia de gravação e transcrição do plano. Cadastro de pacientes, prontuário e consultas escritas continuam sem limite, e há pacotes avulsos de minutos quando a franquia acaba."
                : "Cadastro de pacientes, prontuário e consultas escritas sem limite. A gravação com transcrição depende da franquia de minutos do plano."}
            </p>
          </article>
          <article>
            <UploadSimple size={30} weight="duotone" aria-hidden="true" />
            <h3>Migração acompanhada</h3>
            <p>
              Seus pacientes e prontuários entram com você, junto na chamada. Você não vai recadastrar sua base à mão.
            </p>
          </article>
          <article>
            <Headset size={30} weight="duotone" aria-hidden="true" />
            <h3>Canal direto com a fundadora</h3>
            <p>
              Onboarding individual e um canal direto para dúvidas clínicas e de uso durante os três primeiros meses.
            </p>
          </article>
          <article>
            <Clock size={30} weight="duotone" aria-hidden="true" />
            <h3>Preço travado</h3>
            <p>
              O valor de fundadora se mantém a cada renovação, enquanto a assinatura durar. Reajustes de tabela não
              alcançam quem entrou agora.
            </p>
          </article>
          <article>
            <Notebook size={30} weight="duotone" aria-hidden="true" />
            <h3>Seus dados, sempre seus</h3>
            <p>
              A exportação completa da sua conta não depende de plano ativo. Se você sair, o prontuário sai com você e
              continua legível.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        {/* Same visual weight as the price, on purpose (docs/FUNIL.md T3.1): the
            objection here is not the amount, it is what happens to her records
            if she leaves. */}
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
              continua legível e a exportação completa da sua conta não depende de plano ativo.
            </p>
            {/* Opens in a new tab on purpose: the terms live under the site
                layout, whose header carries the free-plan CTA. Reading them
                must not end the funnel. */}
            <a href="/legal/garantia" target="_blank" rel="noopener noreferrer">
              Ler os termos da garantia
            </a>
          </div>
        </div>
        {open ? (
          <div className="offer-midcta">
            <a className="button" href={checkoutHref}>
              Garantir minha vaga <ArrowRight size={18} />
            </a>
          </div>
        ) : null}
      </section>

      {open ? (
        <section className="section offer-section--tinted">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">Como funciona a entrada</p>
            <h2>
              Três passos, e a chamada <em>fica agendada.</em>
            </h2>
            <p>
              A vaga é contada quando o pagamento confirma. Por PIX isso leva minutos; por boleto, alguns dias úteis.
            </p>
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
                <p>PIX, boleto ou cartão, na própria fatura. Confirmado o pagamento, combinamos a sua chamada.</p>
              </div>
            </li>
          </ol>
        </section>
      ) : null}

      <section className="faq-section section" id="duvidas">
        <div className="faq-intro">
          <p className="eyebrow">Dúvidas</p>
          <h2>Antes de decidir</h2>
          <p>As perguntas que aparecem em toda conversa sobre a condição de fundadora.</p>
        </div>
        <div className="faq-list">
          <details open>
            <summary>
              Preciso pagar tudo de uma vez?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Sim: a condição é anual e a cobrança é única, por PIX, boleto ou cartão — a escolha aparece na própria
              fatura.
              {monthlyEquivalentCents
                ? ` O valor equivale a ${BRL.format(monthlyEquivalentCents / 100)} por mês.`
                : ""}{" "}
              Se o seu cartão permitir parcelar a fatura, isso é uma condição do seu banco, com as regras dele.
            </p>
          </details>
          <details>
            <summary>
              E se eu quiser cancelar? E a renovação?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              A assinatura renova a cada ano, sempre pelo valor travado. Você cancela quando quiser pelo próprio painel
              e mantém o acesso até o fim do período já pago. Dentro dos {guaranteeDays} dias, o reembolso é integral.
            </p>
          </details>
          <details>
            <summary>
              Já uso outro sistema. Como levo meus pacientes?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              A importação de pacientes, do histórico de atendimentos e da agenda já funciona na plataforma, com
              pré-visualização antes de confirmar e opção de desfazer. Na chamada de onboarding fazemos isso junto com
              você.
            </p>
          </details>
          <details>
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
              Serve só para acupuntura?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. O prontuário acompanha o raciocínio da Medicina Tradicional Chinesa e as técnicas que você já usa:
              acupuntura, auriculoterapia, moxabustão, ventosa e dietoterapia chinesa.
            </p>
          </details>
          {audioMinutes > 0 ? (
            <details>
              <summary>
                E quando os minutos acabarem?
                <span aria-hidden="true">+</span>
              </summary>
              <p>
                A condição inclui {NUMBER.format(audioMinutes)} minutos de áudio {audioPeriodLabel}. Quando a franquia
                acaba, o prontuário, a agenda e as consultas escritas seguem funcionando normalmente, e você pode
                comprar um pacote avulso de minutos pelo painel.
              </p>
            </details>
          ) : null}
          <details>
            <summary>
              Já sou assinante do MedChina. Como faço?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Fale com a gente antes de clicar. A troca encerra a assinatura atual e começa a de fundadora, e o período
              já pago do plano anterior não é creditado — então vale combinar a data certa para você não perder dias.
            </p>
          </details>
          <details>
            <summary>
              A IA decide alguma coisa pelo meu paciente?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Não. A IA organiza o que foi relatado, aponta lacunas e prepara hipóteses para a sua revisão. O que não
              foi informado permanece em branco — ausência nunca vira negação — e nada é finalizado sem a sua validação.
            </p>
          </details>
          <details>
            <summary>
              O que acontece com os dados das minhas pacientes?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              A plataforma é desenvolvida com requisitos de privacidade desde a concepção: consentimento separado por
              finalidade, registro de acesso e histórico de alterações. Informações clínicas não são usadas para treinar
              modelos de terceiros.
            </p>
          </details>
        </div>
      </section>

      {open ? (
        <section className="final-cta">
          <div>
            <p className="eyebrow eyebrow--light">A condição vale enquanto houver vaga</p>
            <h2>
              Entre agora como fundadora. <em>Com a migração feita junto com você.</em>
            </h2>
            <div className="hero-actions">
              <a className="button button--light" href={checkoutHref}>
                Garantir minha vaga <ArrowRight size={18} />
              </a>
            </div>
            <ul>
              <li>
                <CheckCircle size={17} weight="fill" /> {guaranteeDays} dias de garantia
              </li>
              <li>
                <CheckCircle size={17} weight="fill" /> Preço travado nas renovações
              </li>
              <li>
                <Notebook size={17} weight="fill" /> Seus dados exportáveis a qualquer momento
              </li>
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}
