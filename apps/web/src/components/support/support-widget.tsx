"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { Box, Button, Card, ClickAwayListener, Fade, Tooltip } from "@mui/material";

import { BRAND } from "@/brand";
import { useRecordingSessionOptional } from "@/components/product/recording-session-provider";
import NiCross from "@/icons/nexture/ni-cross";
import NiEmail from "@/icons/nexture/ni-email";
import NiHeadset from "@/icons/nexture/ni-headset";
import NiPhoneHandset from "@/icons/nexture/ni-phone-handset";
import NiQuestionHexagon from "@/icons/nexture/ni-question-hexagon";
import type { SupportChannels } from "@/lib/platform-settings";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Floating quick-support button (marketing site + dashboard). Channels are
 * configured by the superadmin at /admin/support (platform_settings) and
 * fetched server-side by the layouts (lib/platform-settings.ts), with
 * BRAND.support (@flyee/content) as the static fallback: WhatsApp deep
 * link, email, help center. Renders nothing until a HUMAN channel
 * (whatsapp/email) is configured — a floating button that only repeats
 * the footer is noise.
 */

/**
 * One hue per KIND of channel, so the three rows are told apart by colour
 * before the label is read — the same tinted-badge pattern the cookie notice
 * and the notification bell use, and the same six-hue palette as
 * `components/marketing/tone.ts` (classes are literal so Tailwind's JIT sees
 * them; the widget keeps its own copy because it is also mounted inside the
 * dashboard, which does not import from the marketing layer).
 *
 * The mapping is by MEANING and is not free to rotate:
 * - accent-1 (green) for WhatsApp — the live, someone-answers-now channel.
 * - accent-2 (blue) for e-mail — written, asynchronous.
 * - secondary (camel) for the help centre — reading, not talking to a person.
 *
 * accent-3 (terracotta) is deliberately absent: it already means "needs
 * attention" on the clinical surfaces (anamnesis review states), and the
 * red end of the palette is reserved for risk and failure. A support channel
 * is neither.
 */
const CHANNEL_TONE: Record<string, string> = {
  whatsapp: "bg-accent-1/10 text-accent-1",
  email: "bg-accent-2/10 text-accent-2",
  help: "bg-secondary/10 text-secondary",
};

export default function SupportWidget({ support }: { support?: SupportChannels }) {
  const t = useTranslations("marketing");
  // A capture in progress owns the bottom-right corner. Optional because
  // this widget is also mounted on the marketing site, which has no session.
  const recordingActive = Boolean(useRecordingSessionOptional()?.active);
  const [open, setOpen] = useState(false);
  // Client-side fallback fetch for layouts that cannot fetch server-side
  // (the dashboard layout is a client component). Server-provided `support`
  // (marketing layout) always wins and skips the round trip.
  const [fetched, setFetched] = useState<SupportChannels | null>(null);

  useEffect(() => {
    if (support || !isSupabaseConfigured) return;
    let cancelled = false;
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("platform_settings").select("value").eq("key", "support").maybeSingle();
      const value = (data?.value ?? null) as Partial<SupportChannels> | null;
      if (!cancelled && value) {
        setFetched({
          whatsapp: typeof value.whatsapp === "string" ? value.whatsapp : BRAND.support.whatsapp,
          email: typeof value.email === "string" ? value.email : BRAND.support.email,
          helpCenter: BRAND.support.helpCenter,
        });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [support]);

  const { whatsapp, email, helpCenter } = support ?? fetched ?? BRAND.support;
  if (!whatsapp && !email) return null;

  const channels = [
    whatsapp
      ? {
          key: "whatsapp",
          href: `https://wa.me/${whatsapp}`,
          external: true,
          icon: <NiPhoneHandset size="medium" />,
          label: t("support-widget-whatsapp"),
        }
      : null,
    email
      ? {
          key: "email",
          href: `mailto:${email}`,
          external: true,
          icon: <NiEmail size="medium" />,
          label: t("support-widget-email"),
        }
      : null,
    helpCenter
      ? {
          key: "help",
          href: helpCenter,
          external: false,
          icon: <NiQuestionHexagon size="medium" />,
          label: t("support-widget-help"),
        }
      : null,
  ].filter(Boolean) as { key: string; href: string; external: boolean; icon: React.ReactNode; label: string }[];

  /** The icon in its channel's tinted badge — decorative, the label names it. */
  const badge = (channel: { key: string; icon: React.ReactNode }) => (
    <Box
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        CHANNEL_TONE[channel.key] ?? "bg-primary/10 text-primary",
      )}
    >
      {channel.icon}
    </Box>
  );

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      {/* The recorder's floating bar anchors to this exact corner while a
          capture runs, with "Encerrar" at its right end — and this 56px button
          is rendered later in the DOM at the same z-index, so it painted over
          the one control that must never be missed. Lifted clear of it while
          recording; back in place the moment the capture ends. */}
      <Box
        className={cn(
          "fixed right-5 z-50 flex flex-col items-end gap-3 transition-[bottom]",
          recordingActive ? "bottom-24 sm:bottom-24" : "bottom-5",
        )}
      >
        <Fade in={open} unmountOnExit>
          <Card className="shadow-darker-sm! flex w-72 flex-col gap-1 p-2">
            {channels.map((channel) =>
              channel.external ? (
                <Button
                  key={channel.key}
                  component="a"
                  href={channel.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="text"
                  color="text-primary"
                  size="medium"
                  className="justify-start gap-2"
                  startIcon={badge(channel)}
                >
                  {channel.label}
                </Button>
              ) : (
                <Button
                  key={channel.key}
                  component={Link}
                  href={channel.href}
                  variant="text"
                  color="text-primary"
                  size="medium"
                  className="justify-start gap-2"
                  startIcon={badge(channel)}
                  onClick={() => setOpen(false)}
                >
                  {channel.label}
                </Button>
              ),
            )}
          </Card>
        </Fade>
        <Tooltip title={t("support-widget-label")} placement="left">
          <Button
            variant="contained"
            color="primary"
            aria-label={t("support-widget-label")}
            onClick={() => setOpen((current) => !current)}
            className="h-14 w-14 min-w-0 rounded-full p-0 shadow-lg [&_svg]:h-7 [&_svg]:w-7"
          >
            {open ? <NiCross size="large" /> : <NiHeadset size="large" />}
          </Button>
        </Tooltip>
      </Box>
    </ClickAwayListener>
  );
}
