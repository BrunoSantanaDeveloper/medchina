import PhoneFrame from "@/components/marketing/phone-frame";
import { cn } from "@/lib/utils";

/**
 * Blueprint §15.7, ported 1:1 from the committed reference: the three
 * companion-app screens fanned over a faint ring on the deep band — agenda
 * behind (tilted left), the live recording in front (scaled up), the
 * sent/processing status to the right (tilted right). Fixed 690×565 canvas
 * scaled per breakpoint via --seq-scale; screens are the token PhoneFrame +
 * mocks passed in as slots, so the phone chrome stays the site's own.
 */
const CSS = `
.mkseq{--seq-scale:.5;position:relative;width:calc(690px*var(--seq-scale));height:calc(565px*var(--seq-scale));margin-inline:auto}
@media (min-width:480px){.mkseq{--seq-scale:.62}}
@media (min-width:700px){.mkseq{--seq-scale:.95}}
@media (min-width:960px){.mkseq{--seq-scale:.78}}
@media (min-width:1280px){.mkseq{--seq-scale:.95}}
.mkseq-canvas{position:absolute;top:0;left:0;width:690px;height:565px;transform:scale(var(--seq-scale));transform-origin:top left}
.mkseq-ring{position:absolute;width:520px;height:520px;top:30px;left:35px;border:1px solid hsl(var(--text-contrast)/.08);border-radius:50%}
.mkseq-device{position:absolute;width:200px}
.mkseq-back{z-index:1;top:105px;left:35px;transform:rotate(-7deg);opacity:.86}
.mkseq-front{z-index:3;top:60px;left:230px;transform:scale(1.12)}
.mkseq-side{z-index:2;top:95px;right:0;transform:rotate(7deg);opacity:.9}
`;

export default function MobileSequence({
  back,
  front,
  side,
  ariaLabel,
  className,
}: {
  /** Screen contents (AgendaMock / RecordingMock / StatusMock). */
  back: React.ReactNode;
  front: React.ReactNode;
  side: React.ReactNode;
  /** Translated description of the three-screen illustration. */
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className={cn("mkseq", className)}>
      <style>{CSS}</style>
      <div aria-hidden className="mkseq-canvas">
        <div className="mkseq-ring" />
        <div className="mkseq-device mkseq-back">
          <PhoneFrame className="max-w-none">{back}</PhoneFrame>
        </div>
        <div className="mkseq-device mkseq-front">
          <PhoneFrame className="max-w-none">{front}</PhoneFrame>
        </div>
        <div className="mkseq-device mkseq-side">
          <PhoneFrame className="max-w-none">{side}</PhoneFrame>
        </div>
      </div>
    </div>
  );
}
