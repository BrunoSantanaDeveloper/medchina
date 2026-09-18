import { Suspense } from "react";

import { Box } from "@mui/material";

import Loading from "@/app/loading";
import LocaleAutoNotice from "@/components/layout/locale/locale-auto-notice";
import LocaleSwitch from "@/components/layout/locale/locale-switch";

/**
 * The auth screens are the one place the language can be chosen FOR someone
 * with no way to choose it back: the app's switcher lives in the user menu,
 * which needs the session she is here to open. So the switcher and the
 * automatic-switch notice both belong to this chrome.
 *
 * They OVERLAY the screen instead of sitting above it: every page here is a
 * `min-h-screen` box that centres its card in the viewport, and putting a row
 * in normal flow would push that card off-centre on all ten of them.
 */
export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Box className="relative">
      <Box className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-start gap-3 p-3 sm:p-4">
        <LocaleAutoNotice className="mb-0 max-w-lg flex-1 basis-80" />
        <LocaleSwitch className="ml-auto shrink-0" />
      </Box>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </Box>
  );
}
