import { cn } from "@/lib/utils";

export type AnamnesisFieldState = "clear" | "attention" | "empty";

export type AnamnesisField = {
  label: string;
  /** Extracted value; omit (or empty) for "empty" fields — absence never becomes an answer. */
  value?: string;
  state: AnamnesisFieldState;
  /** Translated state chip text ("Evidência clara" / "Requer atenção" / "Não informado"). */
  stateLabel: string;
};

/**
 * MedChina's signature motif (docs/DESIGN.md): a structured-anamnesis surface
 * with per-field review states — jade = clear evidence, terracotta = needs
 * attention, neutral = not informed. Reused as hero frame media and in the
 * anamnesis/traceability sections so the whole site speaks one clinical
 * language. All content arrives translated via props; mockup data must be
 * FICTITIOUS (patient "Helena Martins", docs/HOME-SPEC.md §7.4).
 */
const STATE_STYLE: Record<AnamnesisFieldState, string> = {
  clear: "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light",
  attention: "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
  empty: "bg-grey-100 text-text-secondary",
};

export default function AnamnesisCard({
  title,
  subtitle,
  fields,
  source,
  className,
}: {
  /** Card heading (e.g. "Anamnese — Helena Martins"). */
  title: string;
  /** Small muted line under the title (e.g. "Consulta de retorno · fictícia"). */
  subtitle?: string;
  fields: AnamnesisField[];
  /** Provenance footnote: the transcript excerpt a field came from. */
  source?: { label: string; quote: string };
  className?: string;
}) {
  return (
    <div
      className={cn("bg-background-paper border-grey-100 shadow-darker-md w-full rounded-3xl border p-5", className)}
    >
      <p className="font-display text-text-primary text-base leading-5 font-bold">{title}</p>
      {subtitle && <p className="text-text-secondary mt-0.5 text-xs">{subtitle}</p>}

      <ul className="mt-4 flex flex-col gap-1.5">
        {fields.map((field) => (
          <li key={field.label} className="bg-background flex min-w-0 items-center gap-3 rounded-xl px-3 py-2">
            <span className="text-text-primary w-20 flex-none text-xs font-semibold">{field.label}</span>
            {/* min-w-0 zeroes the intrinsic contribution of the nowrap value —
                without it the card inflates grid tracks past 375px viewports. */}
            <span className="text-text-secondary min-w-0 flex-1 truncate text-xs">{field.value ?? "—"}</span>
            <span
              className={cn(
                "flex-none rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
                STATE_STYLE[field.state],
              )}
            >
              {field.stateLabel}
            </span>
          </li>
        ))}
      </ul>

      {source && (
        <div className="border-secondary/40 bg-secondary/8 mt-4 rounded-xl border border-dashed px-3 py-2.5">
          <p className="text-secondary-dark dark:text-secondary-light font-mono text-xs font-semibold">
            {source.label}
          </p>
          <p className="text-text-secondary mt-0.5 text-xs leading-4.5 italic">{source.quote}</p>
        </div>
      )}
    </div>
  );
}
