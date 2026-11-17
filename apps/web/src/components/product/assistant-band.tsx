"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import SectionTitle from "@/components/product/section-title";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiAi from "@/icons/nexture/ni-ai";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiSearch from "@/icons/nexture/ni-search";
import { getProductAction } from "@/lib/product-actions";
import { trackCommercialEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";

const BILLING_HREF = `${getProductAction("billing").href}?source=home&feature=plans`;
const PAYMENT_HREF = `${getProductAction("billing").href}?source=home&feature=payment`;
const LIBRARY_HREF = getProductAction("library").href;
const ACERVO_HREF = getProductAction("acervo").href;
const NEW_PATIENT_HREF = getProductAction("new-patient").href;

type Suggestion = {
  key: string;
  icon: React.ReactNode;
  tone: TileTone;
  href?: string;
  onClick?: () => void;
};

/**
 * The band that says what this product does differently, above the day's work.
 *
 * Why it exists (docs/HOME-ASSISTENTE.md): the home was indistinguishable from a
 * conventional EHR — agenda, counters, recent charts — so nothing above the fold
 * claimed the AI that the whole premium tier is built on. The proposal on the
 * table was to replace the home with a chat; that was rejected for a concrete
 * reason: at login her question is "who is next / what is pending", and a prompt
 * box charges her time on EVERY login to win a positioning moment ONCE.
 *
 * So this is a band, not a chat: it names the differentiator, offers a few
 * concrete next actions, and leaves the scannable answer directly below it.
 *
 * Deliberately cheap: every suggestion here is deterministic (a briefing
 * assembled from the record, a route) — no inference, no quota, so it costs
 * nothing to show it to a free workspace on every visit.
 */
export default function AssistantBand({
  hasPatients,
  onPrepareBriefing,
  recordHref,
}: {
  hasPatients: boolean;
  /** Opens the deterministic pre-consultation briefing, when there is one to prepare. */
  onPrepareBriefing?: () => void;
  /** Next consultation to record, when today has one. */
  recordHref?: string;
}) {
  const t = useTranslations("product");
  const { orgId } = useCurrentOrg();
  const { allowance, trialParams } = useAudioAllowance(orgId);

  const suggestions: Suggestion[] = [
    ...(onPrepareBriefing
      ? [
          {
            key: "briefing",
            icon: <NiCalendarClock size="large" />,
            tone: "accent-2" as const,
            onClick: onPrepareBriefing,
          },
        ]
      : []),
    ...(recordHref
      ? [{ key: "record", icon: <NiMicrophone size="large" />, tone: "primary" as const, href: recordHref }]
      : hasPatients
        ? []
        : [
            {
              key: "first-patient",
              icon: <NiMicrophone size="large" />,
              tone: "primary" as const,
              href: NEW_PATIENT_HREF,
            },
          ]),
    { key: "library", icon: <NiBook size="large" />, tone: "accent-4", href: LIBRARY_HREF },
    { key: "acervo", icon: <NiSearch size="large" />, tone: "accent-1", href: ACERVO_HREF },
  ];

  // Branch on the NAMED cause, never on the flags (migration 0054): a failed
  // card is not fixed by buying anything, and a suspension is not fixed by her.
  const reason = allowance?.reason;
  const paymentBlocked = reason === "past_due_blocked" || reason === "past_due_grace";
  const trialInvite = Boolean(allowance?.trialAvailable) && !paymentBlocked;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-3">
          <span
            aria-hidden
            className="bg-primary-light/10 text-primary flex h-12 w-12 flex-none items-center justify-center rounded-2xl"
          >
            <NiAi size="large" />
          </span>
          {/* The differentiator in one line — and it is the CAPTURE, not the
              chat: the chat is the easiest part of this product to copy. It is
              what the band is, read once, so it sits behind the "i" (the owner,
              2026-11-09): the title and the suggestions below claim it on every
              visit without a paragraph. */}
          <SectionTitle
            className="min-w-0"
            title={t("assistant-band-title")}
            description={hasPatients ? t("assistant-band-body") : t("assistant-band-body-empty")}
          />
        </Box>

        {/* The same tile language as the quick actions and the stats: a tinted
            rounded-2xl band holding the icon, then the label in body size. */}
        <Box className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {suggestions.map((suggestion) => {
            const toneStyle = TILE_TONE[suggestion.tone];
            const content = (
              <>
                <Box
                  aria-hidden
                  className={cn(
                    "flex h-14 w-full flex-none items-center justify-center rounded-2xl",
                    toneStyle.bg,
                    toneStyle.text,
                  )}
                >
                  {suggestion.icon}
                </Box>
                <CardContent className="px-2! py-3! text-center">
                  <Typography variant="body2" className="text-text-primary leading-5 font-medium">
                    {t(`assistant-suggestion-${suggestion.key}`)}
                  </Typography>
                </CardContent>
              </>
            );
            return suggestion.href ? (
              <Card
                key={suggestion.key}
                component={Link}
                href={suggestion.href}
                className="flex flex-col p-1 transition-transform hover:scale-[1.02]"
              >
                {content}
              </Card>
            ) : (
              <Card
                key={suggestion.key}
                component="button"
                type="button"
                onClick={suggestion.onClick}
                className="flex cursor-pointer flex-col p-1 text-left transition-transform hover:scale-[1.02]"
              >
                {content}
              </Card>
            );
          })}
        </Box>

        {/* One commercial line at most, and only when it is actionable BY her.
            The minute/day numbers stay in AudioUsageCard — repeating them here
            would be two places to disagree about the same allowance. */}
        {paymentBlocked ? (
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <Typography variant="body2" className="text-text-secondary leading-5">
              {t("assistant-band-past-due")}
            </Typography>
            <Button
              size="small"
              variant="text"
              href={PAYMENT_HREF}
              LinkComponent={Link}
              onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "home", "payment")}
            >
              {t("usage-fix-payment")}
            </Button>
          </Box>
        ) : trialInvite ? (
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <Typography variant="body2" className="text-text-secondary leading-5">
              {trialParams
                ? t("assistant-band-trial", { days: trialParams.days, minutes: trialParams.minutes })
                : t("assistant-band-trial-generic")}
            </Typography>
            <Button
              size="small"
              variant="text"
              href={BILLING_HREF}
              LinkComponent={Link}
              onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "home", "plans")}
            >
              {t("usage-see-plans")}
            </Button>
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
