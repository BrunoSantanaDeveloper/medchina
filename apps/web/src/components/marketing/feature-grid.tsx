import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";

export type Feature = { icon: React.ReactNode; title: string; description: string };

/**
 * Funnel stage: desire. Titles must be benefit-led (the outcome for the
 * customer), never the internal feature name.
 */
export default function FeatureGrid({
  id,
  eyebrow,
  title,
  subtitle,
  features,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  features: Feature[];
}) {
  return (
    <Section id={id}>
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <Reveal stagger={0.08} className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="border-grey-100 bg-background-paper flex flex-col gap-3 rounded-3xl border p-6"
          >
            <span className="bg-primary/10 text-primary flex h-11 w-11 items-center justify-center rounded-xl">
              {feature.icon}
            </span>
            <h3 className="text-text-primary font-heading text-xl font-bold">{feature.title}</h3>
            <p className="text-text-secondary text-base leading-6">{feature.description}</p>
          </div>
        ))}
      </Reveal>
    </Section>
  );
}
