import Container from "./container";

import { cn } from "@/lib/utils";

const SPACING = {
  default: "py-[var(--section-space)]",
  compact: "py-[var(--section-space-sm)]",
} as const;

const BACKGROUND = {
  default: "",
  paper: "bg-background-paper",
  "primary-soft": "bg-primary/5",
} as const;

/**
 * Vertical rhythm unit of every marketing page. All sections MUST be wrapped
 * in <Section> — spacing and width are decided here (marketing tokens), not
 * per page, so pages stay consistent by construction.
 */
export default function Section({
  id,
  spacing = "default",
  background = "default",
  bleed = false,
  className,
  children,
}: {
  id?: string;
  spacing?: keyof typeof SPACING;
  background?: keyof typeof BACKGROUND;
  /** Skip the inner Container (full-bleed content manages its own bounds). */
  bleed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("w-full", SPACING[spacing], BACKGROUND[background], className)}>
      {bleed ? children : <Container>{children}</Container>}
    </section>
  );
}
