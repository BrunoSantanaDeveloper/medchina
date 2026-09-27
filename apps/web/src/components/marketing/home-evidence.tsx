"use client";

import { useState } from "react";

import type { HomeCopy } from "@/components/marketing/home-copy";
import { rich } from "@/components/marketing/home-copy/rich";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowRight,
  ChatCircleText,
  CheckCircle,
  MinusCircle,
  MoonStars,
  Pause,
  Play,
  SealCheck,
  Sparkle,
  Stethoscope,
  TrendUp,
  WarningCircle,
  Waveform,
} from "@phosphor-icons/react";

/**
 * The supervised-evidence demo: a fictitious consultation excerpt on one side,
 * the anamnesis prepared from it on the other, each field carrying its review
 * state (Evidência clara / Requer atenção / Não informado) — the site's
 * signature motif (docs/DESIGN.md).
 *
 * Extracted from the home so /china can show the SAME proof of product instead
 * of describing it in prose (docs/PAGINA-CHINA.md §3, section 5). A client
 * component because the "listen to the source" player holds state.
 */

/** Review state of each prepared field — a tone is a clinical meaning, not copy. */
const EVIDENCE_FIELDS = [
  { id: "sleep", icon: MoonStars, tone: "clear" as const, source: "14:32" },
  { id: "evolution", icon: TrendUp, tone: "attention" as const, source: "14:32" },
  { id: "observation", icon: Stethoscope, tone: "missing" as const, source: undefined },
];

function EvidenceRow({
  icon: Icon,
  label,
  value,
  state,
  tone,
  source,
  listenLabel,
  emptyLabel,
  onPlay,
}: {
  icon: PhosphorIcon;
  label: string;
  value: string;
  state: string;
  tone: "clear" | "attention" | "missing";
  source?: string;
  listenLabel: string;
  emptyLabel: string;
  onPlay: () => void;
}) {
  const StatusIcon = tone === "clear" ? CheckCircle : tone === "attention" ? WarningCircle : MinusCircle;

  return (
    <article className={`evidence-field evidence-field--${tone}`}>
      <span className="evidence-field-icon">
        <Icon size={22} weight="duotone" aria-hidden="true" />
      </span>
      <div className="evidence-field-content">
        <div className="evidence-field-heading">
          <strong>{label}</strong>
          <span className="evidence-status">
            <StatusIcon size={14} weight="fill" aria-hidden="true" /> {state}
          </span>
        </div>
        <p>{value}</p>
        {source ? (
          <button className="evidence-source" type="button" onClick={onPlay}>
            <Play size={12} weight="fill" aria-hidden="true" /> {listenLabel} · {source}
          </button>
        ) : (
          <span className="evidence-source evidence-source--empty">{emptyLabel}</span>
        )}
      </div>
    </article>
  );
}

export default function HomeEvidence({ copy }: { copy: HomeCopy["supervised"] }) {
  const [playing, setPlaying] = useState(false);
  const playSource = () => setPlaying(true);

  return (
    <div className="evidence-layout">
      <article className="conversation-card">
        <div className="conversation-header">
          <span className="conversation-icon">
            <ChatCircleText size={22} weight="duotone" aria-hidden="true" />
          </span>
          <span>
            <small>{copy.conversation.sourceLabel}</small>
            <strong>{copy.conversation.title}</strong>
          </span>
          <span className="conversation-time">{copy.conversation.time}</span>
        </div>
        {/* The extracted terms are marked in the copy itself (==term==), so each
            language highlights the words IT actually uses. */}
        <blockquote>{rich(copy.conversation.quote)}</blockquote>
        <div className={`evidence-player ${playing ? "is-playing" : ""}`}>
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? copy.conversation.pauseAria : copy.conversation.playAria}
          >
            {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
          </button>
          <span>
            <strong>{playing ? copy.conversation.playingLabel : copy.conversation.originalLabel}</strong>
            <small>{copy.conversation.speaker}</small>
          </span>
          <Waveform size={78} weight="duotone" aria-hidden="true" />
          <time>{copy.conversation.duration}</time>
        </div>
      </article>

      <div className="evidence-bridge" aria-hidden="true">
        <span>
          <Sparkle size={18} weight="fill" />
          <ArrowRight size={18} weight="bold" />
        </span>
        <small>{copy.bridgeLabel}</small>
      </div>

      <article className="prepared-card">
        <div className="prepared-header">
          <div>
            <span>
              <Sparkle size={18} weight="duotone" aria-hidden="true" /> {copy.prepared.badge}
            </span>
            <h3>{copy.prepared.title}</h3>
            <p>{copy.prepared.summary}</p>
          </div>
          <span className="review-chip">
            <SealCheck size={15} weight="fill" aria-hidden="true" /> {copy.prepared.reviewChip}
          </span>
        </div>
        <div className="evidence-fields">
          {EVIDENCE_FIELDS.map(({ id, icon, tone, source }) => {
            const field = copy.prepared.fields.find((item) => item.id === id);
            if (!field) return null;

            return (
              <EvidenceRow
                key={id}
                icon={icon}
                label={field.label}
                value={field.value}
                state={field.state}
                tone={tone}
                source={source}
                listenLabel={copy.prepared.listen}
                emptyLabel={copy.prepared.noEvidence}
                onPlay={playSource}
              />
            );
          })}
        </div>
        <div className="prepared-footer">
          <SealCheck size={24} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{copy.prepared.footerTitle}</strong>
            <small>{copy.prepared.footerDetail}</small>
          </span>
        </div>
      </article>
    </div>
  );
}
