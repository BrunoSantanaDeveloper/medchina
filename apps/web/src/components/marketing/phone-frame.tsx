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
        "border-grey-100 bg-background-paper shadow-darker-lg w-full max-w-64 rounded-4xl border p-2.5",
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
/**
 * "Consultas de hoje" screen (blueprint §15.7 screen 1): the day's agenda with
 * fictitious patients. Third row fades — the day continues. Labels translated.
 */
export function AgendaMock({
  heading,
  items,
}: {
  heading: string;
  items: { time: string; name: string; note: string }[];
}) {
  return (
    <div className="flex flex-col gap-2 p-3.5">
      <p className="font-display text-text-primary text-sm font-bold">{heading}</p>
      {items.map((item, index) => (
        <div
          key={item.time}
          className={cn(
            "bg-background-paper border-grey-100 flex items-center gap-2.5 rounded-xl border px-3 py-2",
            index === 2 && "opacity-55",
          )}
        >
          <span className="text-primary flex-none font-mono text-xs font-bold tabular-nums">{item.time}</span>
          <span className="min-w-0">
            <span className="text-text-primary block truncate text-xs font-bold">{item.name}</span>
            <span className="text-text-secondary block truncate text-xs">{item.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Upload/processing status screen (blueprint §15.7 screen 3): the consultation
 * arrived safely and the anamnesis is being prepared. States are honest — the
 * "done" step is jade, the "current" step is camel (in progress, not risk).
 */
export function StatusMock({
  title,
  subtitle,
  steps,
}: {
  title: string;
  subtitle: string;
  steps: { label: string; note: string; state: "done" | "current" }[];
}) {
  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div className="flex flex-col items-center gap-2 py-3 text-center">
        <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light grid h-10 w-10 place-items-center rounded-full text-base font-bold">
          ✓
        </span>
        <p className="font-display text-text-primary text-sm leading-4 font-bold">{title}</p>
        <p className="text-text-secondary text-xs leading-4">{subtitle}</p>
      </div>
      <div className="flex flex-col">
        {steps.map((step) => (
          <div key={step.label} className="border-grey-100 flex items-center gap-2.5 border-t py-2">
            <span
              className={cn(
                "grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold",
                step.state === "done"
                  ? "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light"
                  : "bg-secondary/15 text-secondary-dark dark:text-secondary-light",
              )}
            >
              {step.state === "done" ? "✓" : "…"}
            </span>
            <span className="min-w-0">
              <span className="text-text-primary block text-xs font-bold">{step.label}</span>
              <span className="text-text-secondary block text-xs">{step.note}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
