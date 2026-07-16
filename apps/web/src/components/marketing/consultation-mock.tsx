import { type AnamnesisField, type AnamnesisFieldState } from "@/components/marketing/anamnesis-card";
import { cn } from "@/lib/utils";

/**
 * Token-driven mock of the MedChina web record panel (blueprint hero frame):
 * app topbar, icon sidebar, consultation header with review chip, tab row,
 * field cards in the site's field-state hues and the dark "changes since last
 * consultation" panel. Purely presentational (role="img") — all strings arrive
 * translated, all data is FICTITIOUS (patient "Helena Martins").
 */
export type ConsultationMockLabels = {
  /** Wordmark in the mock topbar (BRAND.name). */
  brand: string;
  search: string;
  kicker: string;
  title: string;
  reviewChip: string;
  tabs: string[];
  fields: AnamnesisField[];
  changesKicker: string;
  changesTitle: string;
  changes: string[];
  changesCta: string;
};

const FIELD_EDGE: Record<AnamnesisFieldState, string> = {
  clear: "border-l-accent-1",
  attention: "border-l-accent-3",
  empty: "border-l-grey-300",
};

const FIELD_CHIP: Record<AnamnesisFieldState, string> = {
  clear: "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light",
  attention: "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
  empty: "bg-grey-100 text-text-secondary",
};

export default function ConsultationMock({
  labels,
  ariaLabel,
  className,
}: {
  labels: ConsultationMockLabels;
  /** Translated description of the whole illustration. */
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn(
        "border-grey-100 bg-background-paper shadow-darker-lg w-full overflow-hidden rounded-3xl border",
        className,
      )}
    >
      <div aria-hidden className="flex min-w-0 flex-col">
        {/* Topbar */}
        <div className="border-grey-100 flex items-center gap-3 border-b px-4 py-2.5">
          <span className="flex items-center gap-1.5">
            <span className="border-primary block h-3.5 w-3.5 rounded-full border-2" />
            <span className="font-display text-text-primary text-xs font-bold">{labels.brand}</span>
          </span>
          <span className="bg-background text-text-disabled ml-auto hidden truncate rounded-lg px-2.5 py-1 text-xs sm:block sm:w-36">
            {labels.search}
          </span>
          <span className="bg-secondary/15 text-secondary-dark dark:text-secondary-light grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold">
            HM
          </span>
        </div>

        <div className="flex min-w-0">
          {/* Sidebar */}
          <div className="border-grey-100 bg-background hidden w-10 flex-none flex-col items-center gap-3 border-r pt-4 pb-4 sm:flex">
            <span className="bg-primary block h-2.5 w-2.5 rounded-sm" />
            <span className="border-grey-300 block h-2.5 w-2.5 rounded-sm border" />
            <span className="border-grey-300 block h-2.5 w-2.5 rounded-sm border" />
            <span className="border-grey-300 block h-2.5 w-2.5 rounded-sm border" />
          </div>

          {/* Record panel */}
          <div className="min-w-0 flex-1 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-text-disabled text-xs font-semibold tracking-wide uppercase">{labels.kicker}</p>
                <p className="font-display text-text-primary truncate text-base font-bold">{labels.title}</p>
              </div>
              <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light flex-none rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap">
                {labels.reviewChip}
              </span>
            </div>

            <div className="bg-grey-100 mt-3 h-0.5 w-full overflow-hidden rounded-full">
              <span className="bg-primary block h-full w-2/3 rounded-full" />
            </div>

            <div className="border-grey-100 mt-3 flex gap-4 overflow-hidden border-b pb-2">
              {labels.tabs.map((tab, index) => (
                <span
                  key={tab}
                  className={cn(
                    "text-xs whitespace-nowrap",
                    index === 0
                      ? "text-primary -mb-2 border-b-2 border-current pb-2 font-bold"
                      : "text-text-secondary font-semibold",
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>

            <div className="mt-3 grid min-w-0 gap-2.5 lg:grid-cols-[1fr_9rem]">
              <div className="flex min-w-0 flex-col gap-2">
                {labels.fields.map((field) => (
                  <div
                    key={field.label}
                    className={cn(
                      "border-grey-100 bg-background min-w-0 rounded-xl border border-l-3 px-3 py-2",
                      FIELD_EDGE[field.state],
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary text-xs font-bold">{field.label}</span>
                      <span
                        className={cn(
                          "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
                          FIELD_CHIP[field.state],
                        )}
                      >
                        {field.stateLabel}
                      </span>
                    </div>
                    <p className="text-text-secondary mt-1 truncate text-xs">{field.value ?? "—"}</p>
                  </div>
                ))}
              </div>

              <div className="bg-primary-dark text-text-contrast hidden flex-col rounded-xl p-3 lg:flex">
                <p className="text-text-contrast/60 text-xs font-semibold tracking-wide uppercase">
                  {labels.changesKicker}
                </p>
                <p className="font-display mt-1 text-sm font-bold">{labels.changesTitle}</p>
                <ul className="mt-2 flex flex-col">
                  {labels.changes.map((change) => (
                    <li
                      key={change}
                      className="border-text-contrast/10 text-text-contrast/80 flex items-center gap-1.5 border-t py-1.5 text-xs"
                    >
                      <span className="bg-secondary block h-1 w-1 flex-none rounded-full" />
                      {change}
                    </li>
                  ))}
                </ul>
                <span className="bg-primary text-text-contrast mt-auto rounded-lg px-2 py-1.5 text-center text-xs font-bold">
                  {labels.changesCta}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
