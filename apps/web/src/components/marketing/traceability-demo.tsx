import Reveal from "@/components/marketing/reveal";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiPlay from "@/icons/nexture/ni-play";

/**
 * Blueprint §19: the provenance demo — one anamnesis field, the audio excerpt
 * it came from, and the four review actions. Purely presentational (role=img):
 * the "buttons" are illustrations of the product, not page controls. The
 * validated action is jade — a professional decision, never red/primary noise.
 */
export default function TraceabilityDemo({
  kicker,
  chip,
  field,
  value,
  origin,
  actions,
  ariaLabel,
}: {
  kicker: string;
  chip: string;
  field: string;
  value: string;
  origin: { kicker: string; quote: string; timecode: string };
  actions: { listen: string; edit: string; reject: string; validated: string };
  ariaLabel: string;
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="border-grey-100 bg-background-paper shadow-darker-lg rounded-3xl border p-6 md:p-8"
    >
      <div aria-hidden>
        <div className="flex items-center justify-between gap-3">
          <p className="text-text-secondary text-xs font-bold tracking-widest uppercase">{kicker}</p>
          <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap">
            {chip}
          </span>
        </div>

        <h3 className="font-display text-text-primary mt-5 text-xl font-bold">{field}</h3>
        <p className="text-text-secondary border-grey-100 mt-1.5 border-b pb-4 text-base leading-6">{value}</p>

        <div className="border-accent-1 bg-accent-1/8 mt-5 grid grid-cols-[auto_1fr_auto] items-center gap-3.5 rounded-r-2xl border-l-3 p-4">
          <span className="bg-primary text-text-contrast grid h-9 w-9 place-items-center rounded-full">
            <NiPlay size="small" />
          </span>
          <span className="min-w-0">
            <span className="text-accent-1-dark dark:text-accent-1-light block text-xs font-bold tracking-wide uppercase">
              {origin.kicker}
            </span>
            <span className="font-display text-text-primary mt-1 block text-sm leading-5 font-bold">
              {origin.quote}
            </span>
          </span>
          <span className="text-text-secondary font-mono text-xs tabular-nums">{origin.timecode}</span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[actions.listen, actions.edit, actions.reject].map((action) => (
            <span
              key={action}
              className="border-grey-100 text-text-secondary rounded-xl border px-2 py-2.5 text-center text-xs font-semibold"
            >
              {action}
            </span>
          ))}
          <span className="bg-accent-1 text-text-contrast rounded-xl px-2 py-2.5 text-center text-xs font-bold">
            ✓ {actions.validated}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The permanent four-source legend (blueprint §19.4): who each piece of
 * information belongs to. Label + swatch + text — never color alone.
 */
export function SourceLegend({ items }: { items: { label: string; tone: Tone }[] }) {
  return (
    <Reveal className="border-grey-100 mt-8 grid grid-cols-1 gap-3 border-t pt-6 sm:grid-cols-2">
      {items.map((item) => {
        const tone = TONE[item.tone];
        return (
          <span key={item.label} className="text-text-secondary flex items-center gap-2.5 text-sm font-semibold">
            <span
              aria-hidden
              className="h-2.5 w-2.5 flex-none rounded-sm"
              style={{ backgroundColor: `hsl(var(${tone.cssVar}))` }}
            />
            {item.label}
          </span>
        );
      })}
    </Reveal>
  );
}
