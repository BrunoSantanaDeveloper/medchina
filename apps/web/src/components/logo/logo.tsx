import { cn } from "@/lib/utils";

/**
 * The single logo component — admin header AND marketing header/footer render this;
 * never create a second logo implementation.
 * Rebrand contract (see src/brand.ts): replace the two SVGs below keeping both
 * variants (full wordmark + compact mobile mark) and the token-based tinting
 * (fill-text-primary / hsl(var(--primary-*)) gradients) so the logo follows
 * every color theme and light/dark mode.
 * Current artwork is a provisional Flyee wordmark (text) + paper-plane mark;
 * swap for the final brand SVGs when they exist.
 */

const Mark = ({ gradientId }: { gradientId: string }) => (
  <>
    <path d="M1 14.5 L21 2 L14.5 25 L10.2 16.8 L16 8.5 L7.8 15.2 Z" fill={`url(#${gradientId})`} />
    <defs>
      <linearGradient id={gradientId} x1="11" y1="2" x2="11" y2="25" gradientUnits="userSpaceOnUse">
        <stop style={{ stopColor: "hsl(var(--primary-light))" }} />
        <stop offset="1" style={{ stopColor: "hsl(var(--primary-dark))" }} />
      </linearGradient>
    </defs>
  </>
);

export default function Logo({ classNameFull, classNameMobile }: { classNameFull?: string; classNameMobile?: string }) {
  return (
    <>
      <svg
        className={cn("fill-current", classNameFull)}
        width="91"
        height="27"
        viewBox="0 0 91 27"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <Mark gradientId="flyee_logo_full" />
        <text
          x="27"
          y="20"
          className="fill-text-primary"
          style={{ fontFamily: "inherit", fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          flyee
        </text>
      </svg>

      <svg
        className={cn("fill-current", classNameMobile)}
        width="22"
        height="27"
        viewBox="0 0 22 27"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <Mark gradientId="flyee_logo_mobile" />
      </svg>
    </>
  );
}
