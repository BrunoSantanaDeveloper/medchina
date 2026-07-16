import { type AnamnesisFieldState } from "@/components/marketing/anamnesis-card";
import Reveal from "@/components/marketing/reveal";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiQuestionHexagon from "@/icons/nexture/ni-question-hexagon";
import { cn } from "@/lib/utils";

const STATE_SYMBOL: Record<AnamnesisFieldState, string> = {
  clear: "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light",
  attention: "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
  empty: "bg-grey-100 text-text-secondary",
};

/**
 * Blueprint §16: the fictitious conversation becoming structured fields —
 * quote card → supervised-organization connector → prepared-anamnesis card
 * with the three field states and the investigation suggestion. The section's
 * whole argument ("absence never becomes an answer") is carried visually: the
 * empty state stays visibly blank.
 */
export default function AnamnesisDemo({
  quote,
  connectorLabel,
  prepared,
}: {
  quote: { kicker: string; text: string; cite: string };
  /** Short line under the connector arrow ("Organização supervisionada"). */
  connectorLabel: string;
  prepared: {
    kicker: string;
    title: string;
    countChip: string;
    rows: { label: string; value: string; state: AnamnesisFieldState; stateLabel: string }[];
    investigation: { title: string; body: string };
  };
}) {
  return (
    <Reveal className="grid grid-cols-1 items-center gap-4 md:grid-cols-[0.9fr_auto_1.2fr] md:gap-6">
      <blockquote className="border-secondary bg-background-paper shadow-darker-md rounded-r-3xl border-l-3 p-7 md:p-9">
        <p className="text-primary text-xs font-bold tracking-widest uppercase">{quote.kicker}</p>
        <p className="font-display text-text-primary mt-4 text-xl leading-7 font-bold md:text-2xl md:leading-8">
          {quote.text}
        </p>
        <cite className="text-text-secondary mt-4 flex items-center gap-2 text-sm not-italic">
          <span aria-hidden className="bg-accent-1 h-1.5 w-1.5 flex-none rounded-full" />
          {quote.cite}
        </cite>
      </blockquote>

      <div className="flex flex-col items-center gap-2">
        <span
          aria-hidden
          className="bg-primary text-text-contrast grid h-10 w-10 rotate-90 place-items-center rounded-full md:rotate-0"
        >
          <NiArrowRight size="medium" />
        </span>
        <span className="text-text-secondary hidden max-w-24 text-center text-xs leading-4 font-semibold md:block">
          {connectorLabel}
        </span>
      </div>

      <div className="border-grey-100 bg-background-paper shadow-darker-md rounded-3xl border p-6 md:p-7">
        <div className="border-grey-100 flex items-start justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-text-secondary text-xs font-bold tracking-widest uppercase">{prepared.kicker}</p>
            <h3 className="font-display text-text-primary mt-1 text-lg font-bold">{prepared.title}</h3>
          </div>
          <span className="bg-primary/10 text-primary flex-none rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap">
            {prepared.countChip}
          </span>
        </div>

        <ul className="flex flex-col">
          {prepared.rows.map((row) => (
            <li
              key={row.label}
              className="border-grey-100 grid grid-cols-[auto_1fr] gap-3 border-b py-3.5 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <span
                aria-hidden
                className={cn(
                  "grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold",
                  STATE_SYMBOL[row.state],
                )}
              >
                {row.state === "clear" ? "✓" : row.state === "attention" ? "!" : "—"}
              </span>
              <span className="min-w-0">
                <span className="text-text-primary block text-sm font-bold">{row.label}</span>
                <span className="text-text-secondary block text-sm leading-5">{row.value}</span>
              </span>
              <span
                className={cn(
                  "col-start-2 justify-self-start rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap sm:col-start-3",
                  STATE_SYMBOL[row.state],
                )}
              >
                {row.stateLabel}
              </span>
            </li>
          ))}
        </ul>

        <div className="bg-secondary/8 mt-4 flex gap-3 rounded-2xl p-4">
          <span className="text-secondary-dark dark:text-secondary-light mt-0.5 flex-none">
            <NiQuestionHexagon size="medium" />
          </span>
          <p className="text-text-secondary text-sm leading-5">
            <span className="text-secondary-dark dark:text-secondary-light block font-bold">
              {prepared.investigation.title}
            </span>
            {prepared.investigation.body}
          </p>
        </div>
      </div>
    </Reveal>
  );
}
