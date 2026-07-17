import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";

/** Template UI examples are a development reference, never a product route. */
export default function UiReferenceLayout({ children }: PropsWithChildren) {
  if (process.env.NODE_ENV !== "development") notFound();
  return children;
}
