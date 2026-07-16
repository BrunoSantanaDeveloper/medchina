import Reveal from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

/**
 * Blueprint §18: the MTC specialization map — an indexed, hairline-ruled grid
 * of the clinical categories the record is built around, with periodic deep
 * accent cells to give the wall rhythm. The camel index digits are the
 * editorial motif shared with NumberStrip/WorkflowDemo.
 */
export default function IndexGrid({
  items,
  accentEvery = 5,
}: {
  items: string[];
  /** Every Nth cell (0-based) takes the deep accent treatment. */
  accentEvery?: number;
}) {
  return (
    <Reveal className="border-grey-100 grid grid-cols-1 border-t border-l sm:grid-cols-2">
      {items.map((item, index) => {
        const accent = index % accentEvery === 0;
        return (
          <div
            key={item}
            className={cn(
              "flex min-h-14 items-center gap-4 border-r border-b px-4.5 py-3 text-sm font-semibold",
              accent
                ? "border-grey-100 bg-primary-dark text-text-contrast"
                : "border-grey-100 bg-background-paper/40 text-text-secondary",
            )}
          >
            <span
              aria-hidden
              className={cn("font-display text-sm font-bold", accent ? "text-secondary-light" : "text-secondary")}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            {item}
          </div>
        );
      })}
    </Reveal>
  );
}
