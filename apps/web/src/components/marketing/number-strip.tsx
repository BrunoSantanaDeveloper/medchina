import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";

/**
 * Blueprint §11 trust strip: a compact contrast band of 3–4 short reassurance
 * items under camel display ordinals, separated by hairlines. The ordinals ARE
 * information here — they read as the adoption path (start free → automate →
 * review → web+mobile). Sits right under the hero; never a full section story.
 */
export default function NumberStrip({ items }: { items: { title: string; body: string }[] }) {
  return (
    <Section spacing="compact" background="contrast">
      <Reveal
        stagger={0.08}
        className="divide-grey-100 grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-y-0 md:grid-cols-4 md:divide-x"
      >
        {items.map((item, index) => (
          <article key={item.title} className="flex gap-4 px-0 py-4 md:px-6 md:py-1 md:first:pl-0 md:last:pr-0">
            <span aria-hidden className="font-display text-secondary flex-none text-lg leading-6 font-bold">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="font-display text-text-primary text-base leading-5 font-bold">{item.title}</p>
              <p className="text-text-secondary mt-1.5 text-sm leading-5">{item.body}</p>
            </div>
          </article>
        ))}
      </Reveal>
    </Section>
  );
}
