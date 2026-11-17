"use client";

import CreateEventDialog from "./create-event-dialog";
import { type EventOverview, eventWhen, STATE_LABEL } from "./event-model";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, IconButton, Menu, MenuItem, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import MetricBars from "@/components/product/metric-bars";
import IllustrationPlatforms from "@/icons/illustrations/illustration-platforms";
import NiArchive from "@/icons/nexture/ni-archive";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiEllipsisVertical from "@/icons/nexture/ni-ellipsis-vertical";
import NiPlus from "@/icons/nexture/ni-plus";
import NiPresentation from "@/icons/nexture/ni-presentation";
import NiSignalUp from "@/icons/nexture/ni-signal-up";
import { eventPath } from "@/lib/live-event-common";
import { createClient } from "@flyee/auth/client";

type Filter = "upcoming" | "live" | "ended" | "archived";

const FILTERS: Record<Filter, (event: EventOverview) => boolean> = {
  upcoming: (event) => !event.archived_at && (event.state === "rascunho" || event.state === "inscricoes"),
  live: (event) => !event.archived_at && event.state === "ao_vivo",
  ended: (event) => !event.archived_at && event.state === "encerrado",
  archived: (event) => Boolean(event.archived_at),
};

const EMPTY_FILTER: Record<Filter, { title: string; description: string }> = {
  upcoming: {
    title: "Nenhum evento a caminho",
    description: "Crie o próximo: ele nasce em rascunho e só abre para o público quando você publicar.",
  },
  live: { title: "Nenhum evento no ar agora", description: "Um evento aparece aqui quando o estado vira “Ao vivo”." },
  ended: {
    title: "Nenhum evento encerrado",
    description: "Os eventos que já aconteceram ficam aqui, com os resultados.",
  },
  archived: {
    title: "Nada arquivado",
    description: "Arquive um evento encerrado para tirá-lo da frente sem perder inscrições nem resultados.",
  },
};

const startsAt = (event: EventOverview) => (event.starts_at ? new Date(event.starts_at).getTime() : null);

/**
 * What is coming reads soonest first; everything else, most recent first. An
 * event without a date always goes last — it is the one least likely to be
 * what the operator came for.
 */
function byRelevance(filter: Filter) {
  return (a: EventOverview, b: EventOverview) => {
    const at = startsAt(a);
    const bt = startsAt(b);
    if (at === null || bt === null) {
      if (at !== bt) return at === null ? 1 : -1;
      return b.updated_at.localeCompare(a.updated_at);
    }
    return filter === "upcoming" ? at - bt : bt - at;
  };
}

/**
 * The events console's first screen (/admin/eventos). The operator's job here
 * is to pick the event she is working on — the one coming up, the one on air
 * — or start the next one; each card answers "how is it going?" with the four
 * numbers that matter and opens the event's own screen.
 */
export default function EventsList() {
  const [events, setEvents] = useState<EventOverview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<EventOverview | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; event: EventOverview } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc("live_events_overview");
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setEvents((data ?? []) as EventOverview[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const all = events ?? [];
    return {
      upcoming: all.filter(FILTERS.upcoming).length,
      live: all.filter(FILTERS.live).length,
      ended: all.filter(FILTERS.ended).length,
      archived: all.filter(FILTERS.archived).length,
    };
  }, [events]);

  // Open on what needs attention: an event on air first, then what is coming.
  const active: Filter =
    filter ?? (counts.live > 0 ? "live" : counts.upcoming > 0 ? "upcoming" : counts.ended > 0 ? "ended" : "upcoming");
  const visible = useMemo(() => (events ?? []).filter(FILTERS[active]).sort(byRelevance(active)), [events, active]);

  if (loadError) {
    return (
      <Alert
        severity="error"
        className="neutral bg-background-paper/60!"
        action={
          <Button color="inherit" size="small" onClick={() => void load()}>
            Tentar de novo
          </Button>
        }
      >
        Não foi possível carregar os eventos: {loadError}
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-5">
      <Box className="flex flex-row flex-wrap items-center justify-between gap-3">
        <Typography variant="body2" color="text.secondary" className="max-w-2xl">
          Cada evento tem a própria página, as próprias inscrições e os próprios resultados. Um evento novo nunca mexe
          nos dados de outro.
        </Typography>
        <Button variant="contained" startIcon={<NiPlus size="medium" />} onClick={() => setCreating(true)}>
          Novo evento
        </Button>
      </Box>

      {events && events.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              illustration={<IllustrationPlatforms />}
              title="Nenhum evento ainda"
              description="Crie o primeiro. Ele nasce em rascunho, e a página só abre quando você publicar."
              action={{ label: "Criar evento", onClick: () => setCreating(true) }}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Box className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile
              icon={<NiCalendar size="large" />}
              tone="primary"
              label="Próximos"
              hint="Rascunhos e eventos com inscrições abertas"
              value={events ? counts.upcoming : "…"}
              onClick={() => setFilter("upcoming")}
              pressed={active === "upcoming"}
            />
            <StatTile
              icon={<NiSignalUp size="large" />}
              tone="accent-1"
              label="Ao vivo"
              value={events ? counts.live : "…"}
              onClick={() => setFilter("live")}
              pressed={active === "live"}
            />
            <StatTile
              icon={<NiPresentation size="large" />}
              tone="secondary"
              label="Encerrados"
              value={events ? counts.ended : "…"}
              onClick={() => setFilter("ended")}
              pressed={active === "ended"}
            />
            <StatTile
              icon={<NiArchive size="large" />}
              tone="accent-2"
              label="Arquivados"
              value={events ? counts.archived : "…"}
              onClick={() => setFilter("archived")}
              pressed={active === "archived"}
            />
          </Box>

          {events && visible.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  illustration={<IllustrationPlatforms />}
                  title={EMPTY_FILTER[active].title}
                  description={EMPTY_FILTER[active].description}
                  action={
                    active === "upcoming" ? { label: "Criar evento", onClick: () => setCreating(true) } : undefined
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <Box className="flex flex-col gap-4">
              {visible.map((event) => (
                <Card key={event.id} component="article" aria-labelledby={`event-${event.id}`}>
                  <CardContent className="flex flex-col gap-4">
                    <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
                      <Box className="min-w-0">
                        <Typography variant="h6" component="h2" id={`event-${event.id}`} className="mb-1">
                          <Link href={`/admin/eventos/${event.id}`} className="text-text-primary hover:underline">
                            {event.title}
                          </Link>
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {eventWhen(event.starts_at)} · {eventPath(event.slug)}
                        </Typography>
                      </Box>
                      <Box className="flex flex-row items-center gap-2">
                        <Chip
                          label={
                            event.archived_at ? `${STATE_LABEL[event.state]} · arquivado` : STATE_LABEL[event.state]
                          }
                          size="small"
                          variant="outlined"
                          color={event.state === "ao_vivo" ? "success" : "grey"}
                          className="text-text-primary!"
                        />
                        <IconButton
                          aria-label={`Mais ações de ${event.title}`}
                          onClick={(click) => setMenu({ anchor: click.currentTarget, event })}
                        >
                          <NiEllipsisVertical size="medium" />
                        </IconButton>
                      </Box>
                    </Box>

                    {/* The event's funnel, from the page to the purchase — each step's
                        share of the widest one. Visits only exist since they
                        started being counted, so an older event can have more
                        registrations than visits: the widest step is the base. */}
                    <MetricBars
                      spacing="dense"
                      total={Math.max(event.visits, event.registrations)}
                      items={[
                        { key: "visits", label: "Visitas à página", value: event.visits, tone: "primary" },
                        { key: "registrations", label: "Inscrições", value: event.registrations, tone: "secondary" },
                        { key: "present", label: "Assistiram ao vivo", value: event.present, tone: "secondary" },
                        { key: "purchases", label: "Compras", value: event.purchases, tone: "secondary" },
                      ]}
                    />

                    <Box>
                      <Button component={Link} href={`/admin/eventos/${event.id}`} variant="outlined" color="grey">
                        Abrir o evento
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </>
      )}

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setDuplicating(menu?.event ?? null);
            setMenu(null);
          }}
        >
          Duplicar
        </MenuItem>
        <MenuItem
          component="a"
          href={menu ? eventPath(menu.event.slug) : "#"}
          target="_blank"
          rel="noopener"
          onClick={() => setMenu(null)}
        >
          Ver a página
        </MenuItem>
      </Menu>

      {creating ? <CreateEventDialog onClose={() => setCreating(false)} /> : null}
      {duplicating ? (
        <CreateEventDialog
          source={{ id: duplicating.id, title: duplicating.title }}
          onClose={() => setDuplicating(null)}
        />
      ) : null}
    </Box>
  );
}
