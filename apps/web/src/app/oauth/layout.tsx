import { Suspense } from "react";

import Loading from "@/app/loading";

/** Standalone chrome, like /auth: the consent screen renders without the app shell. */
export default async function OauthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
