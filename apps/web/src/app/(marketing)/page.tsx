import "./clinical-source-home.css";

import { getDisplayPlans } from "./plans";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import ClinicalSourceHome from "@/components/marketing/clinical-source-home";
import { COOKIE_KEYS } from "@/constants";
import { normalizeCouponCode } from "@/lib/offer-link";
import { resolvePublicCoupon } from "@flyee/billing/public";

export const metadata: Metadata = {
  title: { absolute: "MedChina | Prontuário inteligente para MTC" },
  description:
    "Organize pacientes, anamneses, análises e planos terapêuticos em uma plataforma feita para Medicina Tradicional Chinesa.",
  // Canonical (resolved against metadataBase = NEXT_PUBLIC_SITE_URL) so search
  // engines pick the subdomain as the preferred URL, avoiding duplicate content.
  alternates: { canonical: "/" },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, cookieStore] = await Promise.all([getTranslations("marketing"), searchParams, cookies()]);

  /**
   * Prices and limits are read here, on the server, and handed to the home as
   * data. They used to be constants inside the component, which meant a price
   * change in /admin/billing updated /planos and the checkout while the home
   * went on advertising the old one (docs/FUNIL.md D12).
   */
  const requestedCoupon =
    normalizeCouponCode(typeof params.cupom === "string" ? params.cupom : null) ??
    normalizeCouponCode(cookieStore.get(COOKIE_KEYS.offerCoupon)?.value);
  const coupon = requestedCoupon ? await resolvePublicCoupon(requestedCoupon) : null;
  const plans = await getDisplayPlans(coupon);

  return (
    <ClinicalSourceHome
      plans={plans}
      couponNotice={
        requestedCoupon
          ? coupon
            ? { label: t("pricing-coupon-applied", { code: coupon.code }), applied: true }
            : { label: t("pricing-coupon-unknown", { code: requestedCoupon }), applied: false }
          : undefined
      }
    />
  );
}
