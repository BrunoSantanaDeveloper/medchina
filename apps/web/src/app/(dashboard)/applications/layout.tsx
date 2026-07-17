import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";

/** Generic template applications (including AI Chat) are development-only. */
export default function ApplicationReferenceLayout({ children }: PropsWithChildren) {
  if (process.env.NODE_ENV !== "development") notFound();
  return children;
}
