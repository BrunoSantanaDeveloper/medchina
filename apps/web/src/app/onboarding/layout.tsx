import OnboardingShell from "./components/onboarding-shell";
import type { Metadata } from "next";

/** Authenticated, single-use and personal — nothing here belongs in an index. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <OnboardingShell>{children}</OnboardingShell>;
}
