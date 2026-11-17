"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type SyntheticEvent, useMemo, useState } from "react";

import { Box, Button, Card, CardContent, Tab, Tabs, Typography } from "@mui/material";

import ConsultationStatusChip from "@/components/product/consultation-status-chip";
import EmptyState from "@/components/product/empty-state";
import IllustrationPlatforms from "@/icons/illustrations/illustration-platforms";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChevronLeftSmall from "@/icons/nexture/ni-chevron-left-small";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import { cn } from "@/lib/utils";

export type ScheduleItem = {
  id: string;
  status: string;
  /** ISO instant the visit is anchored to (scheduled time, or start time). */
  at: string;
  patientId: string | null;
  patientName: string;
  note: string | null;
};

const WEEK_DAYS = 7;

/** Calendar day in the practice timezone, as a stable YYYY-MM-DD key. */
export const dayKey = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

/**
 * The template's Schedule card, on real data: a strip of the next seven days
 * to pick from, and the chosen day's visits below it.
 *
 * This is NOT the agenda page. /agenda is where she manages appointments
 * (book, move, cancel, series); this answers the home's question — "what does
 * my week look like, and what is next?" — and hands off to the record or to
 * the agenda for anything more. Today is selected by default, so the first
 * glance still answers "who is next", which is the job of the home.
 */
export default function WeekSchedule({
  items,
  timeZone,
  locale,
  agendaHref,
  scheduleHref,
  startingId,
  onStart,
  onBriefing,
}: {
  items: ScheduleItem[];
  timeZone: string;
  locale: string;
  /** The full agenda, for anything beyond opening the next visit. */
  agendaHref: string;
  /** Where an empty day sends her to book. */
  scheduleHref: string;
  startingId: string | null;
  onStart: (item: ScheduleItem) => void;
  onBriefing: (item: ScheduleItem) => void;
}) {
  const t = useTranslations("product");
  const [selected, setSelected] = useState(0);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: WEEK_DAYS }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      const key = dayKey(date, timeZone);
      return {
        key,
        weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone }).format(date).replace(".", ""),
        day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone }).format(date),
        long: new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone }).format(
          date,
        ),
        items: items
          .filter((item) => dayKey(new Date(item.at), timeZone) === key)
          .sort((a, b) => a.at.localeCompare(b.at)),
      };
    });
  }, [items, locale, timeZone]);

  const current = days[selected] ?? days[0];
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  // Only the first letter: Intl gives "sexta-feira, 11 de setembro" and a CSS
  // `capitalize` would also uppercase the "De".
  const sentence = (text: string) => text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

  return (
    <Card component="section" className="h-full">
      <Box className="flex flex-row items-start justify-between gap-2 px-4 pt-4">
        <Typography variant="h5" component="h2" className="card-title">
          {t("home-week-title")}
        </Typography>
        <Button size="small" variant="text" href={agendaHref} LinkComponent={Link}>
          {t("home-open-agenda")}
        </Button>
      </Box>
      <CardContent className="px-0! pt-0!">
        <Tabs
          className="flex grow"
          classes={{ list: "gap-2 flex grow" }}
          value={selected}
          onChange={(_: SyntheticEvent, value: number) => setSelected(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          scrollButtons
          aria-label={t("home-week-title")}
          slots={{ endScrollButtonIcon: NiChevronRightSmall, startScrollButtonIcon: NiChevronLeftSmall }}
        >
          {days.map((day) => (
            <Tab
              key={day.key}
              className="w-10 [&:not(.Mui-selected)]:border-transparent"
              aria-label={day.long}
              label={
                <Box className="flex flex-col">
                  <Typography className="text-text-secondary capitalize">{day.weekday}</Typography>
                  {/* A day that holds work reads in the brand color; an empty
                      one stays quiet — the strip doubles as a week overview. */}
                  <Typography className={day.items.length ? "text-primary" : "text-text-secondary"}>
                    {day.day}
                  </Typography>
                </Box>
              }
            />
          ))}
        </Tabs>

        <Box className="px-4">
          <Typography className="mb-5">{sentence(current.long)}</Typography>
          {current.items.length === 0 ? (
            <EmptyState
              illustration={<IllustrationPlatforms />}
              titleAs="h3"
              framed={false}
              title={t("agenda-empty-title")}
              description={t("home-today-empty-body")}
              action={{ label: t("home-schedule-cta"), href: scheduleHref }}
            />
          ) : (
            <Box className="flex flex-col gap-4">
              {current.items.map((item) => {
                const live = item.status === "in_progress";
                return (
                  // On a phone the actions drop under the text, aligned with
                  // it, instead of squeezing the name into a third of the row.
                  <Box key={item.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
                    <Box className="flex min-w-0 flex-1 flex-row gap-2.5">
                      {live ? (
                        <NiMicrophone className="text-primary mt-0.5 flex-none" />
                      ) : (
                        <NiCalendarClock className="text-accent-2 mt-0.5 flex-none" />
                      )}
                      <Box className="min-w-0 flex-1">
                        <Box className="flex flex-row flex-wrap items-center gap-2">
                          <Typography variant="subtitle2" className="break-words">
                            {item.patientName}
                          </Typography>
                          <ConsultationStatusChip status={item.status} />
                        </Box>
                        {item.note && (
                          <Typography variant="body2" className="text-text-secondary line-clamp-1">
                            {item.note}
                          </Typography>
                        )}
                        <Typography variant="body2" className="text-text-secondary tabular-nums">
                          {time(item.at)}
                        </Typography>
                      </Box>
                    </Box>
                    <Box className={cn("flex flex-none flex-row flex-wrap justify-end gap-1 pl-8 sm:pl-0")}>
                      {item.patientId && (
                        <Button size="small" variant="text" color="grey" onClick={() => onBriefing(item)}>
                          {t("briefing-prepare")}
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="text"
                        color="primary"
                        disabled={startingId === item.id}
                        onClick={() => onStart(item)}
                      >
                        {item.status === "scheduled" ? t("agenda-start") : t("home-open-draft")}
                      </Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
