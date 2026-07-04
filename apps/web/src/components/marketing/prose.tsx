import { cn } from "@/lib/utils";

/**
 * Long-form reading layout (legal pages, articles): measured line length and
 * consistent heading/paragraph rhythm without styling each element by hand.
 */
export default function Prose({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-prose flex-col",
        "[&_h2]:font-heading [&_h2]:text-text-primary [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-bold",
        "[&_h3]:font-heading [&_h3]:text-text-primary [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-bold",
        "[&_p]:text-text-secondary [&_p]:mb-4 [&_p]:text-base [&_p]:leading-7",
        "[&_ul]:text-text-secondary [&_li]:mb-1 [&_li]:leading-7 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
