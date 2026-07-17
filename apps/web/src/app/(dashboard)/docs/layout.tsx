import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";

/** Template documentation is intentionally unreachable in production. */
export default function DocsReferenceLayout({ children }: PropsWithChildren) {
  if (process.env.NODE_ENV !== "development") notFound();
  return children;
}
