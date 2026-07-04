import "@/style/global.css";

import { Metadata } from "next";
import { Mulish, Urbanist } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Suspense } from "react";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";

import Loading from "@/app/loading";
import { BRAND } from "@/brand";
import BackgroundWrapper from "@/components/layout/containers/background-wrapper";
import SnackbarWrapper from "@/components/layout/containers/snackbar-wrapper";
import LayoutContextProvider from "@/components/layout/layout-context";
import ThemeProvider from "@/theme/theme-provider";

const mulish = Mulish({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap", // Use 'swap' to ensure text remains visible during font loading
  preload: true,
});

const urbanist = Urbanist({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  title: {
    default: BRAND.name,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  icons: {
    icon: [
      {
        media: "(prefers-color-scheme: dark)",
        url: BRAND.favicon.dark,
        href: BRAND.favicon.dark,
      },
      {
        media: "(prefers-color-scheme: light)",
        url: BRAND.favicon.light,
        href: BRAND.favicon.light,
      },
    ],
    apple: BRAND.favicon.light,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      style={{ "--inner-shadow-opacity": "0.6", "--foreground-opacity": "0.6" } as React.CSSProperties}
      className={`${mulish.variable} ${urbanist.variable}`}
    >
      <head>
        {/* We need to include the loader CSS directly to avoid flash of unstyled content */}
        <link rel="stylesheet" href="/initial-loader.css" />

        {/* Load the loader script directly for fastest execution */}
        <Script id="loader-script" src="/initial-loader.js" strategy="beforeInteractive" />
      </head>
      <body className="antialiased">
        {/* Initial loader */}
        <div id="initial-loader">
          <div className="spinner"></div>
        </div>
        {/* Initial loader end */}
        <AppRouterCacheProvider
          options={{
            key: "css",
            prepend: false,
            enableCssLayer: true,
          }}
        >
          <ThemeProvider>
            <NextIntlClientProvider messages={messages}>
              <LayoutContextProvider>
                <BackgroundWrapper />
                <SnackbarWrapper>
                  <Suspense fallback={<Loading />}>{children}</Suspense>
                </SnackbarWrapper>
              </LayoutContextProvider>
            </NextIntlClientProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
