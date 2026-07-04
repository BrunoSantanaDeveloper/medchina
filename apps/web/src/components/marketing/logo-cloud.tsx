import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";

/**
 * Funnel stage: trust. Without real client logos, names render as muted
 * wordmarks; derived projects replace `items` with SVG logos (token-tinted).
 */
export default function LogoCloud({
  label,
  items,
}: {
  label: string;
  items: { name: string; logo?: React.ReactNode }[];
}) {
  return (
    <Section spacing="compact">
      <Reveal className="flex flex-col items-center gap-6">
        <p className="text-text-secondary text-sm">{label}</p>
        <ul className="flex flex-row flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {items.map((item) => (
            <li key={item.name} className="text-text-muted font-heading text-xl font-bold tracking-tight">
              {item.logo ?? item.name}
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
