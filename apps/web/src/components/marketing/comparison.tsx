import Reveal from "@/components/marketing/reveal";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiCheck from "@/icons/nexture/ni-check";
import NiCross from "@/icons/nexture/ni-cross";

export type ComparisonSide = {
  /** Small uppercase label ("Antes" / "Com o MedChina"). */
  label: string;
  /** Short display heading for the card. */
  title: string;
  items: string[];
};

/**
 * Blueprint §13 before/after: two cards joined by a bridge arrow — the muted
 * "before" on paper, the "after" on the deep teal band with camel checks. No
 * blame language in the copy (the professional's manual method is respected).
 * Collapses to a vertical sequence with a rotated bridge on mobile.
 */
export default function Comparison({ before, after }: { before: ComparisonSide; after: ComparisonSide }) {
  return (
    <Reveal className="grid grid-cols-1 items-stretch gap-0 md:grid-cols-[1fr_auto_1fr]">
      <article className="border-grey-100 bg-background-paper rounded-3xl border p-7 md:p-9">
        <p className="text-text-secondary text-xs font-bold tracking-widest uppercase">{before.label}</p>
        <h3 className="font-display text-display-md text-text-secondary mt-3 font-bold">{before.title}</h3>
        <ul className="mt-6 flex flex-col">
          {before.items.map((item) => (
            <li
              key={item}
              className="border-grey-100 text-text-secondary flex items-start gap-2.5 border-t py-2.5 text-base leading-6"
            >
              <NiCross size="small" className="text-grey-500 mt-0.5 flex-none" />
              {item}
            </li>
          ))}
        </ul>
      </article>

      <div className="z-10 -my-3 flex items-center justify-center md:-mx-5 md:my-0">
        <span
          aria-hidden
          className="border-background bg-background-paper text-primary shadow-darker-sm grid h-12 w-12 rotate-90 place-items-center rounded-full border-4 md:rotate-0"
        >
          <NiArrowRight size="medium" />
        </span>
      </div>

      <article className="bg-primary-dark text-text-contrast shadow-darker-lg rounded-3xl p-7 md:p-9">
        <p className="text-text-contrast/60 text-xs font-bold tracking-widest uppercase">{after.label}</p>
        <h3 className="font-display text-display-md mt-3 font-bold">{after.title}</h3>
        <ul className="mt-6 flex flex-col">
          {after.items.map((item) => (
            <li
              key={item}
              className="border-text-contrast/10 text-text-contrast/85 flex items-start gap-2.5 border-t py-2.5 text-base leading-6"
            >
              <NiCheck size="small" className="text-secondary-light mt-0.5 flex-none" />
              {item}
            </li>
          ))}
        </ul>
      </article>
    </Reveal>
  );
}
