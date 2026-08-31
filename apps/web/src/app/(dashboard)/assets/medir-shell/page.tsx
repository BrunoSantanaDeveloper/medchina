"use client";

import Link from "next/link";
import { type ReactNode } from "react";

import Timeline from "@mui/lab/Timeline";
import TimelineConnector from "@mui/lab/TimelineConnector";
import TimelineContent from "@mui/lab/TimelineContent";
import TimelineDot from "@mui/lab/TimelineDot";
import TimelineItem from "@mui/lab/TimelineItem";
import TimelineOppositeContent from "@mui/lab/TimelineOppositeContent";
import TimelineSeparator from "@mui/lab/TimelineSeparator";
import { Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiBadgeCheck from "@/icons/nexture/ni-badge-check";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPen from "@/icons/nexture/ni-pen";
import NiSlashHexagon from "@/icons/nexture/ni-slash-hexagon";

const EVENT_TONE = {
  active: "bg-primary-light/10 text-primary",
  done: "bg-accent-1-light/10 text-accent-1",
  pending: "bg-accent-2-light/10 text-accent-2",
  imported: "bg-secondary-light/10 text-secondary-dark dark:text-secondary",
  inert: "bg-grey-100 text-text-secondary",
};

const SCHEDULED_TITLE = "Retorno de acupuntura: dor lombar crônica com irradiação ciática direita";

export default function MedirShell() {
  return (
    <Grid container spacing={5}>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-3">
            <Typography variant="h5" component="h2" className="card-title">
              Linha do tempo
            </Typography>
            <Timeline>
              <TimelineEvent
                dateLabel="02/09/2026"
                timeLabel="09:30"
                tone={EVENT_TONE.pending}
                icon={<NiCalendarClock />}
                first
                last={false}
              >
                <Box
                  data-probe="row-scheduled"
                  className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors md:flex-row md:flex-wrap md:items-center md:gap-3"
                >
                  <Box data-probe="title-scheduled" className="w-full min-w-0 flex-1">
                    <Typography
                      data-probe="text-scheduled"
                      variant="body1"
                      className="text-text-primary truncate font-medium"
                    >
                      {SCHEDULED_TITLE}
                    </Typography>
                    <Typography variant="caption" className="text-text-secondary block sm:sr-only">
                      02/09/2026 09:30
                    </Typography>
                  </Box>
                  <span
                    data-probe="chip-scheduled"
                    className="bg-grey-100 text-text-secondary flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
                  >
                    Agendada
                  </span>
                  <Button data-probe="btn-scheduled" size="small" aria-label="Iniciar atendimento 02/09/2026 09:30">
                    Iniciar atendimento
                  </Button>
                </Box>
              </TimelineEvent>

              <VisitRow
                probe="finalized-1"
                dateLabel="18/08/2026"
                timeLabel={null}
                tone={EVENT_TONE.done}
                icon={<NiCheckSquare />}
                title={SCHEDULED_TITLE}
                chip="Finalizada"
                chipClass="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
              />

              <TimelineEvent
                dateLabel="18/08/2026"
                timeLabel="10:12"
                tone={EVENT_TONE.active}
                icon={<NiMicrophone />}
                first={false}
                last={false}
              >
                <Link
                  href="#"
                  data-probe="row-transcription"
                  className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3"
                >
                  <Box data-probe="title-transcription" className="w-full min-w-0 flex-1">
                    <Typography variant="body1" className="text-text-primary truncate font-medium">
                      Transcrição da consulta
                    </Typography>
                    <Typography variant="caption" className="text-text-secondary block sm:sr-only">
                      18/08/2026 10:12
                    </Typography>
                  </Box>
                  <span className="bg-primary/10 text-primary-dark dark:text-primary-light flex-none rounded-full px-2.5 py-1 text-xs font-semibold">
                    Transcrição
                  </span>
                </Link>
              </TimelineEvent>

              <VisitRow
                probe="finalized-2"
                dateLabel="04/08/2026"
                timeLabel={null}
                tone={EVENT_TONE.done}
                icon={<NiCheckSquare />}
                title={SCHEDULED_TITLE}
                chip="Finalizada"
                chipClass="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
              />

              <TimelineEvent
                dateLabel="21/07/2026"
                timeLabel="14:00"
                tone={EVENT_TONE.inert}
                icon={<NiSlashHexagon />}
                first={false}
                last={false}
              >
                <Box
                  data-probe="row-cancelled"
                  className="flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                >
                  <Box data-probe="title-cancelled" className="w-full min-w-0 flex-1">
                    <Typography variant="body1" className="text-text-primary truncate font-medium">
                      {SCHEDULED_TITLE}
                    </Typography>
                    <Typography variant="caption" className="text-text-secondary block sm:sr-only">
                      21/07/2026 14:00
                    </Typography>
                  </Box>
                  <span className="bg-grey-100 text-text-secondary flex-none rounded-full px-2.5 py-1 text-xs font-semibold">
                    Cancelada
                  </span>
                </Box>
              </TimelineEvent>

              <TimelineEvent
                dateLabel="09/06/2026"
                timeLabel={null}
                tone={EVENT_TONE.imported}
                icon={<NiArrowHistory />}
                first={false}
                last={false}
              >
                <Link
                  href="#"
                  data-probe="row-legacy"
                  className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3"
                >
                  <Box data-probe="title-legacy" className="w-full min-w-0 flex-1">
                    <Typography variant="body1" className="text-text-primary truncate font-medium">
                      {SCHEDULED_TITLE}
                    </Typography>
                    <Typography variant="caption" className="text-text-secondary block sm:sr-only">
                      09/06/2026
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      importado de outro sistema
                    </Typography>
                  </Box>
                  <span className="bg-grey-100 text-text-secondary flex-none rounded-full px-2.5 py-1 text-xs font-semibold">
                    Finalizada
                  </span>
                </Link>
              </TimelineEvent>

              <TimelineEvent
                dateLabel="02/06/2026"
                timeLabel="11:40"
                tone={EVENT_TONE.active}
                icon={<NiBadgeCheck />}
                first={false}
                last={false}
              >
                <Link
                  href="#"
                  data-probe="row-document"
                  className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3"
                >
                  <Box data-probe="title-document" className="w-full min-w-0 flex-1">
                    <Typography variant="body1" className="text-text-primary truncate font-medium">
                      Plano terapêutico · versão 2
                    </Typography>
                    <Typography variant="caption" className="text-text-secondary block sm:sr-only">
                      02/06/2026 11:40
                    </Typography>
                  </Box>
                  <span className="bg-primary/10 text-primary-dark dark:text-primary-light flex-none rounded-full px-2.5 py-1 text-xs font-semibold">
                    Emitido
                  </span>
                </Link>
              </TimelineEvent>

              <VisitRow
                probe="draft"
                dateLabel="19/05/2026"
                timeLabel={null}
                tone={EVENT_TONE.inert}
                icon={<NiPen />}
                title={SCHEDULED_TITLE}
                chip="Rascunho"
                chipClass="bg-grey-100 text-text-secondary"
              />

              <VisitRow
                probe="finalized-3"
                dateLabel="05/05/2026"
                timeLabel={null}
                tone={EVENT_TONE.done}
                icon={<NiCheckSquare />}
                title={SCHEDULED_TITLE}
                chip="Finalizada"
                chipClass="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
              />

              <VisitRow
                probe="finalized-4"
                dateLabel="21/04/2026"
                timeLabel={null}
                tone={EVENT_TONE.done}
                icon={<NiCheckSquare />}
                title={SCHEDULED_TITLE}
                chip="Finalizada"
                chipClass="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
                last
              />
            </Timeline>
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }} className="flex flex-col gap-5">
        <Card component="section">
          <CardContent className="flex flex-col gap-3">
            <Typography variant="h5" component="h2" className="card-title mb-0">
              Coluna lateral
            </Typography>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

function VisitRow({
  probe,
  dateLabel,
  timeLabel,
  tone,
  icon,
  title,
  chip,
  chipClass,
  last = false,
}: {
  probe: string;
  dateLabel: string;
  timeLabel: string | null;
  tone: string;
  icon: ReactNode;
  title: string;
  chip: string;
  chipClass: string;
  last?: boolean;
}) {
  const whenLabel = timeLabel ? dateLabel + " " + timeLabel : dateLabel;
  return (
    <TimelineEvent dateLabel={dateLabel} timeLabel={timeLabel} tone={tone} icon={icon} first={false} last={last}>
      <Link
        href="#"
        data-probe={"row-" + probe}
        className="hover:bg-grey-25 flex flex-col items-start gap-1 rounded-2xl px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3"
      >
        <Box data-probe={"title-" + probe} className="w-full min-w-0 flex-1">
          <Typography variant="body1" className="text-text-primary truncate font-medium">
            {title}
          </Typography>
          <Typography variant="caption" className="text-text-secondary block sm:sr-only">
            {whenLabel}
          </Typography>
        </Box>
        <span className={"flex-none rounded-full px-2.5 py-1 text-xs font-semibold " + chipClass}>{chip}</span>
      </Link>
    </TimelineEvent>
  );
}

function TimelineEvent({
  dateLabel,
  timeLabel,
  tone,
  icon,
  first,
  last,
  children,
}: {
  dateLabel: string;
  timeLabel: string | null;
  tone: string;
  icon: ReactNode;
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  return (
    <TimelineItem>
      <TimelineOppositeContent
        aria-hidden
        className="m-auto hidden shrink-0 grow-0 basis-20 pr-2 pl-0 whitespace-nowrap sm:block"
      >
        <Typography variant="body2" className="text-text-primary font-medium">
          {dateLabel}
        </Typography>
        {timeLabel && (
          <Typography variant="caption" className="text-text-secondary block">
            {timeLabel}
          </Typography>
        )}
      </TimelineOppositeContent>
      <TimelineSeparator>
        <TimelineConnector className={first ? "invisible" : undefined} />
        <TimelineDot aria-hidden className={"my-1 rounded-lg p-2 " + tone}>
          {icon}
        </TimelineDot>
        <TimelineConnector className={last ? "invisible" : undefined} />
      </TimelineSeparator>
      <TimelineContent className="my-auto min-w-0 py-0 pr-0 pl-2">{children}</TimelineContent>
    </TimelineItem>
  );
}
