"use client";
import "@/style/global.css";

import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { LicenseInfo } from "@mui/x-license";

import Loading from "@/app/loading";
import CookieConsent from "@/components/consent/cookie-consent";
import AnnouncementBanner from "@/components/layout/announcements/announcement-banner";
import ContentWrapper from "@/components/layout/containers/content-wrapper";
import Header from "@/components/layout/containers/header";
import Main from "@/components/layout/containers/main";
import LeftMenu from "@/components/layout/menu/left-menu";
import MenuBackdrop from "@/components/layout/menu/menu-backdrop";
import RecordingSessionProvider from "@/components/product/recording-session-provider";
import SupportWidget from "@/components/support/support-widget";

LicenseInfo.setLicenseKey(process.env.NEXT_PUBLIC_MUI_X_LICENSE_KEY || "");

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const t = useTranslations("product");
  return (
    <RecordingSessionProvider exitMessage={t("recorder-leave-warning")}>
      <a
        href="#main-content"
        className="bg-primary text-primary-contrast fixed top-3 left-3 z-[2000] -translate-y-20 rounded-lg px-4 py-3 transition-transform focus:translate-y-0"
      >
        {t("skip-to-content")}
      </a>
      <Header />
      <LeftMenu />
      <Main>
        <ContentWrapper>
          <AnnouncementBanner />
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </ContentWrapper>
      </Main>
      <MenuBackdrop />
      <SupportWidget />
      <CookieConsent />
    </RecordingSessionProvider>
  );
}
