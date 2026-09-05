import "./fundadores.css";

import { Metadata } from "next";

import { getFoundersOffer } from "@/lib/founders-offer";
import { getGuaranteeDays } from "@/lib/guarantee";
import { getPlanBySlug } from "@flyee/billing/public";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Headset,
  Notebook,
  ShieldCheck,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = {
  title: "Condição de fundadora — MedChina",
  description:
    "Acesso completo ao MedChina Pro pelo preço do Assistente, por 12 meses, para um número limitado de profissionais de Medicina Tradicional Chinesa.",
  // Deliberately out of the index AND out of the sitemap (docs/FUNIL.md D10):
  // this is a private condition sent to a specific audience, and a price that
  // ranks on Google is no longer a limited offer — it is the price.
  robots: { index: false, follow: false },
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

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
 *  - **Every number is real.** Seats, deadline and price come from
 *    `founders_offer()` and the plan row (migrations 0085/0087) — the SAME call
 *    that refuses the checkout when they run out. No decay timer, no "restam
 *    poucas". This is sold inside a small professional community where the
 *    founder's reputation is the asset (docs/FUNIL.md).
 *  - **No fabricated proof.** The plan asks for three testimonials with name,
 *    photo and city; there are none yet, and HOME-SPEC §33.5 forbids inventing
 *    them. So the page ships without that block rather than with a fake one —
 *    it gets added once the first founders give real ones (T4.4).
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
  const checkoutHref = plan
    ? `/auth/sign-up?next=${encodeURIComponent(`/settings/billing?plan=${plan.slug}`)}`
    : "/contato";

  const savings =
    plan && comparePlan && comparePlan.priceCents > plan.priceCents
      ? Math.round(((comparePlan.priceCents - plan.priceCents) / comparePlan.priceCents) * 100)
      : null;

  const deadlineLabel = offer?.deadline
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" }).format(new Date(offer.deadline))
    : null;

  return (
    <main className="clinical-source-home">
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
                  {comparePlan && savings ? (
                    <p className="offer-price-was">
                      <s>{BRL.format(comparePlan.priceCents / 100)}/ano</s>
                      <span className="offer-price-badge">{savings}% de economia</span>
                    </p>
                  ) : null}
                  <p className="offer-price-now">
                    <strong>{BRL.format(plan.priceCents / 100)}</strong>
                    <small>por ano</small>
                  </p>
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
        <section className="section">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">Quantas restam</p>
            <h2>
              A turma de fundadoras é <em>pequena de propósito.</em>
            </h2>
            <p>
              Cada fundadora recebe migração acompanhada e onboarding individual com a fundadora do MedChina. É esse
              limite de agenda — não uma tática de venda — que define o número de vagas.
            </p>
          </div>
          {/* Every figure below is a live count of subscriptions on the offer
              plan, from the same function that stops the checkout. */}
          <div className={`offer-seats ${offer.seatsLeft <= 0 ? "offer-seats--closed" : ""}`}>
            <p className="offer-seats-count">
              {offer.seatsLeft > 0 ? `${offer.seatsLeft} de ${offer.seatsTotal} vagas disponíveis` : "Vagas esgotadas"}
            </p>
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
            {deadlineLabel ? <p className="offer-seats-note">Ou até {deadlineLabel}, o que vier primeiro.</p> : null}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">O que só a fundadora recebe</p>
          <h2>
            Não é só preço. É <em>entrar acompanhada.</em>
          </h2>
        </div>
        <div className="offer-includes">
          <article>
            <Sparkle size={30} weight="duotone" aria-hidden="true" />
            <h3>Raciocínio clínico do Pro</h3>
            <p>
              Hipóteses de padrão explicadas, com sinais favoráveis, contradições e dados ausentes — sempre preparadas
              para a sua revisão, nunca aplicadas sozinhas.
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
            <p>Onboarding individual e um canal direto para dúvidas clínicas e de uso durante os primeiros meses.</p>
          </article>
          <article>
            <Clock size={30} weight="duotone" aria-hidden="true" />
            <h3>Preço travado</h3>
            <p>
              O valor de fundadora se mantém a cada renovação, enquanto a assinatura durar. Reajustes de tabela não
              alcançam quem entrou agora.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        {/* Same visual weight as the price, on purpose: the objection here is
            not the amount, it is what happens to her records if she leaves. */}
        <div className="offer-guarantee">
          <span className="offer-guarantee-icon">
            <ShieldCheck size={30} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <h3>{guaranteeDays} dias de garantia, e seus dados são sempre seus</h3>
            <p>
              Se não fizer sentido para a sua prática, você pede o reembolso em até {guaranteeDays} dias. Saindo agora
              ou daqui a dois anos, o prontuário continua legível e a exportação completa da sua conta não depende de
              plano ativo.
            </p>
            <a href="/legal/garantia">Ler os termos da garantia</a>
          </div>
        </div>
      </section>

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
              A condição é anual e pode ser paga por PIX, boleto ou cartão — a escolha aparece na própria fatura. No
              cartão, a cobrança segue as opções de parcelamento do seu banco.
            </p>
          </details>
          <details>
            <summary>
              E se eu quiser cancelar?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Você cancela quando quiser pelo próprio painel. Dentro dos {guaranteeDays} dias, o reembolso é integral.
              Depois disso, o acesso continua até o fim do período já pago e não há renovação automática indesejada.
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
              modelos públicos.
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
