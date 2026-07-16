"use client";
import { useId, useState } from "react";

import NiCheck from "@/icons/nexture/ni-check";
import NiExclamationHexagon from "@/icons/nexture/ni-exclamation-hexagon";
import NiQuestionHexagon from "@/icons/nexture/ni-question-hexagon";
import NiTrendUp from "@/icons/nexture/ni-trend-up";
import { cn } from "@/lib/utils";

/**
 * Blueprint §12: the interactive consultation-flow demo. Four tabs (Conversa →
 * Anamnese → Análise → Plano) show the SAME fictitious information travelling
 * through the product: spoken quote → mapped field → exception review → plan
 * decision. Client component only for the tab state; all strings arrive
 * translated. Ordinals stay — the sequence IS the information here.
 *
 * Family hues follow the committed mapping: jade = clear evidence, terracotta
 * = needs attention, camel = professional decision/investigation, plum = AI
 * inference.
 */
export type WorkflowStepCopy = {
  tab: string;
  hint: string;
  pill: string;
  title: string;
  body: string;
};

export default function WorkflowDemo({
  tabsLabel,
  conversation,
  mapping,
  analysis,
  plan,
}: {
  /** Accessible name of the tablist. */
  tabsLabel: string;
  conversation: WorkflowStepCopy & {
    consentTitle: string;
    consentNote: string;
    speakerKicker: string;
    quote: string;
    speakers: [string, string];
    protectedLabel: string;
    timeStart: string;
    timeEnd: string;
  };
  mapping: WorkflowStepCopy & {
    quote: string;
    quoteSource: string;
    fieldKicker: string;
    fieldValue: string;
    fieldMeta: string;
  };
  analysis: WorkflowStepCopy & {
    items: { kind: "change" | "investigate" | "attention"; title: string; note: string }[];
  };
  plan: WorkflowStepCopy & {
    rows: { badge: string; title: string; note: string; tag: string; professional?: boolean }[];
    cta: string;
  };
}) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const steps = [conversation, mapping, analysis, plan];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? (active + 1) % steps.length : (active + steps.length - 1) % steps.length;
    setActive(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  };

  const evidences = [
    // 1 · Conversa — dialogue excerpt + audio strip + speaker tags.
    <div key="conversation" className="border-grey-100 bg-background rounded-2xl border p-5 md:p-6">
      <p className="text-primary text-xs font-bold tracking-widest uppercase">{conversation.speakerKicker}</p>
      <p className="font-display text-text-primary mt-3 text-lg leading-6 font-bold md:text-xl md:leading-7">
        {conversation.quote}
      </p>
      <div className="bg-primary-dark text-text-contrast mt-5 flex items-center gap-3 rounded-xl px-3.5 py-2.5">
        <span className="font-mono text-xs tabular-nums">{conversation.timeStart}</span>
        <span aria-hidden className="flex h-5 flex-1 items-center gap-0.5 overflow-hidden">
          {Array.from({ length: 32 }).map((_, index) => (
            <span
              key={index}
              className="bg-text-contrast/50 w-0.5 flex-none rounded-full"
              style={{ height: `${index % 4 === 0 ? 85 : index % 3 === 0 ? 55 : 30}%` }}
            />
          ))}
        </span>
        <span className="font-mono text-xs tabular-nums">{conversation.timeEnd}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-full px-2.5 py-1 text-xs font-bold">
          {conversation.speakers[0]}
        </span>
        <span className="bg-secondary/15 text-secondary-dark dark:text-secondary-light rounded-full px-2.5 py-1 text-xs font-bold">
          {conversation.speakers[1]}
        </span>
        <span className="text-text-secondary ml-auto text-xs font-semibold">{conversation.protectedLabel}</span>
      </div>
    </div>,

    // 2 · Anamnese — quote mapped onto the structured field.
    <div
      key="mapping"
      className="bg-background grid grid-cols-1 items-center gap-3 rounded-2xl p-5 md:grid-cols-[1fr_auto_1fr] md:p-6"
    >
      <div className="border-grey-100 bg-background-paper rounded-2xl border p-5">
        <p className="font-display text-text-primary text-lg leading-6 font-bold">{mapping.quote}</p>
        <p className="text-text-secondary mt-4 text-xs font-semibold">{mapping.quoteSource}</p>
      </div>
      <span
        aria-hidden
        className="bg-primary text-text-contrast mx-auto grid h-9 w-9 rotate-90 place-items-center rounded-full text-sm font-bold md:rotate-0"
      >
        →
      </span>
      <div className="border-grey-100 bg-background-paper border-l-accent-1 rounded-2xl border border-l-3 p-5">
        <p className="text-accent-1-dark dark:text-accent-1-light text-xs font-bold tracking-widest uppercase">
          {mapping.fieldKicker}
        </p>
        <p className="font-display text-text-primary mt-2 text-lg leading-6 font-bold">{mapping.fieldValue}</p>
        <p className="text-text-secondary mt-3 text-xs font-semibold">{mapping.fieldMeta}</p>
      </div>
    </div>,

    // 3 · Análise — the exception stack.
    <div key="analysis" className="flex flex-col gap-2.5">
      {analysis.items.map((item) => (
        <div key={item.title} className="border-grey-100 bg-background flex items-center gap-4 rounded-2xl border p-4">
          <span
            className={cn(
              "grid h-10 w-10 flex-none place-items-center rounded-xl",
              item.kind === "change" && "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light",
              item.kind === "investigate" && "bg-secondary/15 text-secondary-dark dark:text-secondary-light",
              item.kind === "attention" && "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
            )}
          >
            {item.kind === "change" && <NiTrendUp size="medium" />}
            {item.kind === "investigate" && <NiQuestionHexagon size="medium" />}
            {item.kind === "attention" && <NiExclamationHexagon size="medium" />}
          </span>
          <span className="min-w-0">
            <span className="text-text-primary block text-sm font-bold">{item.title}</span>
            <span className="text-text-secondary block text-sm">{item.note}</span>
          </span>
        </div>
      ))}
    </div>,

    // 4 · Plano — AI suggestion vs professional decision.
    <div key="plan" className="bg-background flex flex-col gap-2.5 rounded-2xl p-5 md:p-6">
      {plan.rows.map((row) => (
        <div
          key={row.title}
          className="border-grey-100 bg-background-paper grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border p-3.5"
        >
          <span
            className={cn(
              "grid h-9 w-9 place-items-center rounded-full text-xs font-bold",
              row.professional
                ? "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light"
                : "bg-accent-4/12 text-accent-4-dark dark:text-accent-4-light",
            )}
          >
            {row.badge}
          </span>
          <span className="min-w-0">
            <span className="text-text-primary block text-sm font-bold">{row.title}</span>
            <span className="text-text-secondary block truncate text-xs">{row.note}</span>
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap",
              row.professional
                ? "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light"
                : "bg-accent-4/12 text-accent-4-dark dark:text-accent-4-light",
            )}
          >
            {row.tag}
          </span>
        </div>
      ))}
      <span
        aria-hidden
        className="bg-primary text-text-contrast mt-1 flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold"
      >
        {plan.cta}
        <span>→</span>
      </span>
    </div>,
  ];

  return (
    <div className="border-grey-100 bg-background-paper shadow-darker-md overflow-hidden rounded-3xl border">
      <div
        role="tablist"
        aria-label={tabsLabel}
        className="border-grey-100 divide-grey-100 grid grid-cols-4 border-b md:divide-x"
      >
        {steps.map((step, index) => (
          <button
            key={step.tab}
            id={`${baseId}-tab-${index}`}
            role="tab"
            type="button"
            aria-selected={active === index}
            aria-controls={`${baseId}-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={onKeyDown}
            className={cn(
              "relative flex flex-col items-start gap-0.5 px-3 py-4 text-left transition-colors md:flex-row md:items-baseline md:gap-2.5 md:px-6 md:py-5",
              active === index ? "bg-background-paper" : "bg-background hover:bg-background-paper cursor-pointer",
            )}
          >
            <span aria-hidden className="font-display text-secondary text-sm font-bold">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "font-display block text-sm font-bold md:text-base",
                  active === index ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {step.tab}
              </span>
              <span className="text-text-secondary hidden text-xs md:block">{step.hint}</span>
            </span>
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-colors md:inset-x-6",
                active === index ? "bg-primary" : "bg-transparent",
              )}
            />
          </button>
        ))}
      </div>

      {steps.map((step, index) => (
        <div
          key={step.tab}
          id={`${baseId}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={active !== index}
          className="grid grid-cols-1 items-center gap-8 p-6 md:grid-cols-[0.8fr_1.2fr] md:gap-12 md:p-10"
        >
          <div>
            <span className="bg-primary/10 text-primary inline-flex rounded-lg px-2.5 py-1.5 text-xs font-bold tracking-widest uppercase">
              {step.pill}
            </span>
            <h3 className="font-display text-display-md text-text-primary mt-4 font-bold">{step.title}</h3>
            <p className="text-text-secondary mt-3 text-base leading-6">{step.body}</p>
            {index === 0 && (
              <div className="border-grey-100 bg-background mt-5 flex items-center gap-3 rounded-xl border p-3.5">
                <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light grid h-8 w-8 flex-none place-items-center rounded-full">
                  <NiCheck size="small" />
                </span>
                <span>
                  <span className="text-text-primary block text-sm font-bold">{conversation.consentTitle}</span>
                  <span className="text-text-secondary block text-xs">{conversation.consentNote}</span>
                </span>
              </div>
            )}
          </div>
          <div className="min-w-0">{evidences[index]}</div>
        </div>
      ))}
    </div>
  );
}
