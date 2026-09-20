import { testimonialsToRender } from "@/lib/testimonials";
import { Quotes } from "@phosphor-icons/react/dist/ssr";

/**
 * Prova social das páginas de oferta.
 *
 * A seção não decide nada sobre o que é verdade: ela renderiza o que
 * `lib/testimonials.ts` autoriza, e some por completo quando não há nada
 * aprovado. É por isso que o componente pode ser colocado nas páginas antes
 * de os depoimentos reais existirem — em produção ele simplesmente não aparece
 * até alguém marcar `approved: true` com o consentimento registrado.
 *
 * Onde fica na página: depois da prova de produto e antes da garantia. Quem
 * chegou por anúncio já viu o que a plataforma faz; o depoimento responde
 * "funcionou para alguém como eu?", que é a objeção imediatamente anterior a
 * "e se eu me arrepender?".
 *
 * `tinted` existe mas fica desligado nas duas páginas de oferta: elas alternam
 * seção clara e seção tingida de cima a baixo, e uma seção tingida a mais
 * colaria duas faixas escuras uma na outra. Duas seções claras seguidas passam
 * despercebidas; duas tingidas viram uma tarja.
 */
export default function OfferTestimonials({
  eyebrow = "Quem já usa",
  title,
  accent,
  tinted = false,
}: {
  eyebrow?: string;
  title: string;
  /** Fecho da manchete, destacado pelo Landing DS. */
  accent: string;
  tinted?: boolean;
}) {
  const { entries, draft } = testimonialsToRender();
  if (entries.length === 0) return null;

  return (
    /* Whole class strings, not a template literal: the Prettier Tailwind
       plugin rewrites class expressions and silently ate the separating space
       here, shipping `sectionoffer-section--tinted`. */
    <section className={tinted ? "section offer-section--tinted" : "section"}>
      <div className="section-heading section-heading--center">
        <p className="eyebrow">{eyebrow}</p>
        <h2>
          {title} <em>{accent}</em>
        </h2>
        {draft ? (
          <p className="offer-quotes-draft">
            RASCUNHO — textos provisórios, visíveis apenas em desenvolvimento. Publique em
            <code> src/lib/testimonials.ts</code> marcando <code>approved: true</code> com o consentimento registrado.
          </p>
        ) : null}
      </div>
      <div className="offer-quotes">
        {entries.map((entry) => (
          <figure key={`${entry.name}-${entry.quote.slice(0, 24)}`}>
            <Quotes size={26} weight="fill" aria-hidden="true" />
            <blockquote>{entry.quote}</blockquote>
            <figcaption>
              <strong>{entry.name}</strong>
              <span>{entry.role}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
