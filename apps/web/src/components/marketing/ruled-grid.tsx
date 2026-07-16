import Link from "next/link";

import Reveal from "@/components/marketing/reveal";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import { cn } from "@/lib/utils";

export type RuledGridItem = {
  /** Meaningful concept icon (@/icons/nexture/ni-*), tinted by `tone`. */
  icon?: React.ReactNode;
  title: string;
  body: string;
  tone?: Tone;
  /** Optional trailing text link (e.g. "Ver como é explicado" → #rastreabilidade). */
  link?: { label: string; href: string };
};

/**
 * Blueprint's ruled grid: cells separated by hairlines instead of card gaps —
 * the editorial "one surface, many rooms" look used by the benefits (§14,
 * light 3-col), the security pillars (§22, deep 2-col) and the reasoning trio
 * (§17, cards). Icons are meaningful concept glyphs in the family hue.
 */
export default function RuledGrid({
  items,
  columns = 3,
  variant = "light",
}: {
  items: RuledGridItem[];
  columns?: 2 | 3;
  /** light = hairline grid on the page ground; deep = hairline grid on the deep band; cards = separated rounded cards. */
  variant?: "light" | "deep" | "cards";
}) {
  const cols = columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";

  if (variant === "cards") {
    return (
      <Reveal stagger={0.08} className={cn("grid grid-cols-1 gap-5", cols)}>
        {items.map((item) => {
          const tone = TONE[item.tone ?? "primary"];
          return (
            <article key={item.title} className="border-grey-100 bg-background-paper rounded-3xl border p-7">
              {item.icon && (
                <span
                  className={cn("mb-5 inline-grid h-12 w-12 place-items-center rounded-2xl", tone.softBg, tone.text)}
                >
                  {item.icon}
                </span>
              )}
              <h3 className="font-display text-text-primary text-xl leading-6 font-bold">{item.title}</h3>
              <p className="text-text-secondary mt-2.5 text-base leading-6">{item.body}</p>
              {item.link && (
                <Link
                  href={item.link.href}
                  className={cn("mt-4 inline-flex items-center gap-1.5 text-sm font-bold", tone.text)}
                >
                  {item.link.label}
                  <NiArrowRight size="small" />
                </Link>
              )}
            </article>
          );
        })}
      </Reveal>
    );
  }

  const deep = variant === "deep";
  return (
    <Reveal
      stagger={0.06}
      className={cn("grid grid-cols-1 border-t border-l", cols, deep ? "border-text-contrast/15" : "border-grey-100")}
    >
      {items.map((item) => {
        const tone = TONE[item.tone ?? "primary"];
        return (
          <article
            key={item.title}
            className={cn(
              "border-r border-b p-7 transition-colors md:p-8",
              deep ? "border-text-contrast/15 hover:bg-text-contrast/5" : "border-grey-100 hover:bg-background-paper",
            )}
          >
            {item.icon && (
              <span
                className={cn(
                  "mb-5 inline-grid h-11 w-11 place-items-center rounded-xl",
                  deep ? "bg-text-contrast/10 text-secondary-light" : cn(tone.softBg, tone.text),
                )}
              >
                {item.icon}
              </span>
            )}
            <h3
              className={cn(
                "font-display text-lg leading-6 font-bold",
                deep ? "text-text-contrast" : "text-text-primary",
              )}
            >
              {item.title}
            </h3>
            <p className={cn("mt-2.5 text-base leading-6", deep ? "text-text-contrast/70" : "text-text-secondary")}>
              {item.body}
            </p>
          </article>
        );
      })}
    </Reveal>
  );
}
