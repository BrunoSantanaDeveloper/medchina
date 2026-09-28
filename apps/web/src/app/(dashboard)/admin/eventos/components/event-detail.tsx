"use client";

import { getEventsConsoleStatus } from "../actions";
import EventContentForm from "./event-content-form";
import EventEmails from "./event-emails";
import { type ConsoleEvent, EVENT_SELECT, type EventResults, eventWhen, STATE_LABEL } from "./event-model";
import EventRegistrations from "./event-registrations";
import EventResultsView from "./event-results";
import EventSettingsForm from "./event-settings-form";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Chip, Grid, Tab, Tabs, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiPresentation from "@/icons/nexture/ni-presentation";
import { eventPath } from "@/lib/live-event-common";
import { createClient } from "@flyee/auth/client";

type TabKey = "resultados" | "inscritas" | "pagina" | "configuracao" | "emails";

/**
 * One event (/admin/eventos/[id]). Results first — how is THIS event doing —
 * then the people who registered for it, the page's copy, its settings and its
 * e-mails. Everything here is scoped to this event; person-level actions
 * (opt-out, LGPD erasure, the ad audience) also live in /admin/leads.
 */
export default function EventDetail({ id }: { id: string }) {
  const [event, setEvent] = useState<ConsoleEvent | null | undefined>(undefined);
  const [results, setResults] = useState<EventResults | null>(null);
  // A failed results load is an ERROR, never "no results": the tabs that read
  // it (results, settings, e-mails) must not act as if there were zero people.
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("resultados");
  const [status, setStatus] = useState<{ emailConfigured: boolean } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [eventResult, resultsResult] = await Promise.all([
      supabase.from("live_events").select(EVENT_SELECT).eq("id", id).maybeSingle(),
      supabase.rpc("live_event_results", { target_event: id }),
    ]);
    if (eventResult.error) {
      setLoadError(eventResult.error.message);
      return;
    }
    setLoadError(null);
    setEvent((eventResult.data as unknown as ConsoleEvent | null) ?? null);
    const payload = resultsResult.data as EventResults | null;
    if (resultsResult.error || !payload?.ok) {
      setResultsError(resultsResult.error?.message ?? "a consulta dos resultados não respondeu");
      setResults(null);
    } else {
      setResultsError(null);
      setResults(payload);
    }
  }, [id]);

  useEffect(() => {
    load();
    getEventsConsoleStatus().then(setStatus);
  }, [load]);

  const header = (title: string) => (
    <Grid size={12}>
      <Typography variant="h1" component="h1" className="mb-0">
        {title}
      </Typography>
      <Breadcrumbs>
        <Link color="inherit" href="/inicio">
          Início
        </Link>
        <Typography variant="body2">Admin</Typography>
        <Link color="inherit" href="/admin/eventos">
          Eventos ao vivo
        </Link>
      </Breadcrumbs>
    </Grid>
  );

  if (loadError) {
    return (
      <Grid container spacing={5}>
        {header("Evento")}
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Não foi possível carregar o evento: {loadError}
          </Alert>
        </Grid>
      </Grid>
    );
  }

  if (event === null) {
    return (
      <Grid container spacing={5}>
        {header("Evento")}
        <Grid size={12}>
          <EmptyState
            icon={<NiPresentation size="large" />}
            title="Evento não encontrado"
            description="Ele pode ter sido excluído (só rascunhos sem inscrições podem ser)."
            action={{ label: "Voltar aos eventos", href: "/admin/eventos" }}
          />
        </Grid>
      </Grid>
    );
  }

  if (event === undefined)
    return (
      <Grid container spacing={5}>
        {header("Evento")}
      </Grid>
    );

  return (
    <Grid container spacing={5}>
      {header(event.title)}

      <Grid size={12} className="flex flex-row flex-wrap items-center gap-3">
        <Chip
          label={event.archived_at ? `${STATE_LABEL[event.state]} · arquivado` : STATE_LABEL[event.state]}
          size="small"
          variant="outlined"
          color={event.state === "ao_vivo" ? "success" : "grey"}
          className="text-text-primary!"
        />
        <Typography variant="body2" color="text.secondary">
          {eventWhen(event.starts_at)}
        </Typography>
        <Button
          component="a"
          href={eventPath(event.slug)}
          target="_blank"
          rel="noopener"
          variant="outlined"
          color="grey"
          size="small"
        >
          {event.state === "rascunho" ? "Ver a prévia da página" : "Ver a página"}
        </Button>
      </Grid>

      {status && !status.emailConfigured ? (
        <Grid size={12}>
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            O envio de e-mail não está configurado (RESEND_API_KEY): a confirmação e os lembretes não saem. O grupo de
            avisos e a página continuam funcionando.
          </Alert>
        </Grid>
      ) : null}

      <Grid size={12}>
        <Tabs
          value={tab}
          onChange={(_, value: TabKey) => setTab(value)}
          aria-label="Seções do evento"
          variant="scrollable"
          className="mb-4"
        >
          <Tab value="resultados" label="Resultados" />
          <Tab value="inscritas" label="Inscritas" />
          <Tab value="pagina" label="Página" />
          <Tab value="configuracao" label="Configuração" />
          <Tab value="emails" label="E-mails" />
        </Tabs>

        {resultsError ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60! mb-4"
            action={
              <Button color="inherit" size="small" onClick={() => void load()}>
                Tentar de novo
              </Button>
            }
          >
            Não foi possível carregar os resultados deste evento: {resultsError}
          </Alert>
        ) : null}

        {/* The panels stay mounted and only the active one shows: switching
            tabs must not throw away a half-written page or settings form. The
            list of registrations is the exception — it holds nothing unsaved,
            reads fresh on every visit, and a Data Grid mounted inside a hidden
            box measures a zero height (MUI X warns and lays out at 0px). */}
        <Box hidden={tab !== "resultados"}>
          <EventResultsView
            results={results}
            failed={Boolean(resultsError)}
            event={event}
            onOpenSettings={() => setTab("configuracao")}
          />
        </Box>
        {tab === "inscritas" ? <EventRegistrations event={event} /> : null}
        <Box hidden={tab !== "pagina"}>
          <EventContentForm event={event} onSaved={load} />
        </Box>
        <Box hidden={tab !== "configuracao"}>
          <EventSettingsForm event={event} registrations={results ? results.registrations : null} onSaved={load} />
        </Box>
        <Box hidden={tab !== "emails"}>
          <EventEmails
            eventId={event.id}
            endedBehavior={event.ended_behavior}
            registrations={results ? results.registrations : null}
            sent={results?.emails ?? null}
            emailConfigured={status?.emailConfigured ?? false}
            onSent={load}
          />
        </Box>
      </Grid>
    </Grid>
  );
}
