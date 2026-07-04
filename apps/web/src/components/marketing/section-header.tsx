import { cn } from "@/lib/utils";

/**
 * Standard heading block for a marketing section: eyebrow, display-scale
 * title and supporting subtitle. Keeps hierarchy identical across sections.
 */
export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-10 flex max-w-2xl flex-col gap-3 md:mb-14",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {eyebrow && <p className="text-primary text-sm font-semibold tracking-wide uppercase">{eyebrow}</p>}
      <h2 className="font-display text-display-lg text-text-primary font-bold">{title}</h2>
      {subtitle && <p className="text-text-secondary text-lg leading-6">{subtitle}</p>}
    </div>
  );
}
