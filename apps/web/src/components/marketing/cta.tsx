import Link from "next/link";

import { Button } from "@mui/material";

import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";

/**
 * Funnel stage: recovery — the last conversion opportunity on the page.
 * The button label must repeat the page's primary CTA verbatim.
 */
export default function Cta({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle?: string;
  cta: { label: string; href: string };
}) {
  return (
    <Section>
      <Reveal>
        <div className="bg-primary/5 flex flex-col items-center gap-4 rounded-4xl px-6 py-14 text-center md:py-20">
          <h2 className="font-display text-display-lg text-text-primary max-w-2xl font-bold">{title}</h2>
          {subtitle && <p className="text-text-secondary max-w-xl text-lg leading-6">{subtitle}</p>}
          <Button
            size="large"
            variant="contained"
            color="primary"
            href={cta.href}
            LinkComponent={Link}
            className="mt-2"
          >
            {cta.label}
          </Button>
        </div>
      </Reveal>
    </Section>
  );
}
