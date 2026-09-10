import ContactForm from "./contact-form";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    title: t("contact-meta-title"),
    description: t("contact-meta-description"),
    alternates: { canonical: "/contato" },
  };
}

/**
 * Message the form opens with, per known `?assunto=`.
 *
 * An ALLOWLIST, never the raw parameter: the query string is written by whoever
 * sends the link, and echoing it into the body of an e-mail the operation reads
 * would let a stranger compose that e-mail. Unknown values are ignored.
 *
 * The one entry today comes from the closed state of `/fundadores`, which says
 * "fale com a gente" to someone who arrived after the seats ran out. Landing
 * her on an empty form made her explain from scratch what she was answering.
 */
const SUBJECT_PREFILL: Record<string, string> = {
  fundadores:
    "Olá! Recebi o link da condição de fundadora e cheguei depois do fechamento. Gostaria de saber quais são as opções.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("marketing");
  const params = await searchParams;
  const subject = typeof params.assunto === "string" ? params.assunto : "";

  return (
    <Section spacing="compact">
      <SectionHeader title={t("contact-title")} subtitle={t("contact-subtitle")} as="h1" />
      <Reveal>
        <ContactForm initialMessage={SUBJECT_PREFILL[subject] ?? ""} />
      </Reveal>
    </Section>
  );
}
