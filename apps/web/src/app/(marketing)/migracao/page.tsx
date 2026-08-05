import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Cta from "@/components/marketing/cta";
import ProcessSteps from "@/components/marketing/process-steps";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiArchiveCheck from "@/icons/nexture/ni-archive-check";
import NiMessage from "@/icons/nexture/ni-message";
import NiSearch from "@/icons/nexture/ni-search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return { title: t("mig-meta-title"), description: t("mig-meta-description"), alternates: { canonical: "/migracao" } };
}

/**
 * /migracao — previous-version users (HOME-SPEC §23): honest expectations,
 * no automatic-migration promise, no deadline or free-of-charge commitment.
 * The CTA goes to support, not to checkout.
 */
export default async function MigrationPage() {
  const t = await getTranslations("marketing");

  return (
    <>
      <Section decor="glow" spacing="compact">
        <SectionHeader as="h1" title={t("mig-title")} subtitle={t("mig-subtitle")} />
      </Section>

      <ProcessSteps
        title={t("mig-steps-title")}
        variant="icon"
        steps={[
          { icon: <NiMessage size="large" />, title: t("mig-1-title"), body: t("mig-1-body"), tone: "accent-2" },
          { icon: <NiSearch size="large" />, title: t("mig-2-title"), body: t("mig-2-body"), tone: "accent-3" },
          { icon: <NiArchiveCheck size="large" />, title: t("mig-3-title"), body: t("mig-3-body"), tone: "accent-1" },
        ]}
      />

      <Section spacing="compact">
        <div className="border-grey-100 bg-background-paper mx-auto max-w-3xl rounded-3xl border p-6">
          <p className="text-text-primary font-display text-base font-bold">{t("mig-note-title")}</p>
          <p className="text-text-secondary mt-2 text-sm leading-6">{t("mig-note-body")}</p>
        </div>
      </Section>

      <Cta
        title={t("mig-cta-title")}
        subtitle={t("mig-cta-subtitle")}
        cta={{ label: t("mig-cta"), href: "/contato" }}
      />
    </>
  );
}
