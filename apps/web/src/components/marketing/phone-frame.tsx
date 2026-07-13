import { cn } from "@/lib/utils";

/**
 * Token-driven phone chrome for mobile-app evidence (the companion-app story).
 * Like <ProductFrame>, it frames REAL screenshots when they exist; until then
 * compose it with <RecordingMock> (below) — never leave a naked text section
 * about the app. Width is controlled by the parent (satellite/breakout media).
 */
export default function PhoneFrame({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "border-grey-100 bg-background-paper shadow-darker-lg w-full max-w-64 rounded-[2rem] border p-2.5",
        className,
      )}
    >
      <div aria-hidden className="bg-grey-100 mx-auto mb-2 h-1.5 w-16 rounded-full" />
      <div className="bg-background overflow-hidden rounded-3xl">{children}</div>
      <div aria-hidden className="bg-grey-100 mx-auto mt-2 h-1 w-10 rounded-full" />
    </div>
  );
}

/**
 * The Modo Consulta screen as a token mock (fictitious data only): recording
 * state, live timer chip, waveform-ish bars and the three big actions the PRD
 * gives the consultation screen (pause / voice note / finish). All labels
 * arrive translated.
 */
export function RecordingMock({
  patient,
  statusLabel,
  timer,
  pauseLabel,
  voiceLabel,
  finishLabel,
}: {
  patient: string;
  statusLabel: string;
  timer: string;
  pauseLabel: string;
  voiceLabel: string;
  finishLabel: string;
}) {
  const bars = [38, 62, 46, 74, 58, 82, 50, 68, 44, 60];
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <p className="font-display text-text-primary text-sm font-bold">{patient}</p>

      <div className="bg-accent-3/12 flex items-center gap-2 rounded-xl px-3 py-2">
        <span aria-hidden className="bg-accent-3 h-2 w-2 flex-none animate-pulse rounded-full" />
        <span className="text-accent-3-dark dark:text-accent-3-light text-xs font-bold">{statusLabel}</span>
        <span className="text-text-secondary ml-auto font-mono text-xs tabular-nums">{timer}</span>
      </div>

      <div aria-hidden className="flex h-10 items-end justify-between gap-1 px-1">
        {bars.map((height, index) => (
          <span key={index} className="bg-primary/50 w-1.5 rounded-full" style={{ height: `${height}%` }} />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="bg-background-paper border-grey-100 text-text-secondary rounded-xl border px-3 py-2 text-center text-xs font-semibold">
          {pauseLabel}
        </div>
        <div className="bg-background-paper border-grey-100 text-text-secondary rounded-xl border px-3 py-2 text-center text-xs font-semibold">
          {voiceLabel}
        </div>
        <div className="bg-primary text-text-contrast rounded-xl px-3 py-2 text-center text-xs font-bold">
          {finishLabel}
        </div>
      </div>
    </div>
  );
}
