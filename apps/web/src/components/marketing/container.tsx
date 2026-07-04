import { cn } from "@/lib/utils";

/**
 * Horizontal bounds for all marketing content: max width and responsive
 * padding come from the marketing tokens, never from per-page values.
 */
export default function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("mx-auto w-full max-w-[var(--container-max)] px-[var(--container-px)]", className)}>
      {children}
    </div>
  );
}
