"use client";

import { Field, SelectField } from "../../billing/components/catalog-shared";
import { type ReminderKind, sendLiveEventReminder } from "../actions";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, FormLabel, Typography } from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import MetricBars from "@/components/product/metric-bars";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";
import { formatMobileBrInput, normalizeMobileBr } from "@flyee/fields";

type EventState = "rascunho" | "inscricoes" | "ao_vivo" | "encerrado";

type EventRow = {
  id: string;
  slug: string;
  title: string;
  starts_at: string | null;
  duration_minutes: number | null;
  state: EventState;
  owner_phone: string | null;
  group_invite_url: string | null;
  stream_url: string | null;
  recording_url: string | null;
  ip_window_limit: number;
};

type RegistrationCounts = {
  total: number;
  group: number;
  whatsapp: number;
  present: number;
  sent: Record<ReminderKind, number>;
};

const STATE_OPTIONS: { value: EventState; label: string }[] = [
  { value: "rascunho", label: "Rascunho · a página responde 404 (só superadmin vê a prévia)" },
  { value: "inscricoes", label: "Inscrições abertas · convite e formulário" },
  { value: "ao_vivo", label: "Ao vivo · a página vira a sala" },
  { value: "encerrado", label: "Encerrado · gravação e captura curta" },
];

const STATE_CHIP: Record<EventState, string> = {
  rascunho: "Rascunho",
  inscricoes: "Inscrições abertas",
  ao_vivo: "Ao vivo",
  encerrado: "Encerrado",
};

const REMINDERS: { kind: ReminderKind; label: string }[] = [
  { kind: "day_before", label: "Enviar lembrete da véspera" },
  { kind: "hour_before", label: "Enviar lembrete de 1 hora" },
  { kind: "live", label: "Enviar “começou”" },
  { kind: "recording", label: "Enviar gravação" },
];

/** Brazil has had no daylight saving since 2019: Brasília is UTC−3 all year. */
function toBrasiliaInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function fromBrasiliaInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The events tab of /admin/leads (docs/PAGINA-EVENTO.md §7): what each event
 * page shows is data edited here — date, state, the Community's owner number,
 * the invite, the stream, the recording — so changing any of it is a save, not
 * a deploy. The reminder buttons send one kind of e-mail to everyone eligible,
 * once (the page records who already got it).
 */
export default function EventsAdmin() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, RegistrationCounts>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [eventsResult, registrationsResult] = await Promise.all([
      supabase
        .from("live_events")
        .select(
          "id, slug, title, starts_at, duration_minutes, state, owner_phone, group_invite_url, stream_url, recording_url, ip_window_limit",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("live_event_registrations")
        .select(
          "event_id, group_clicked_at, whatsapp_started_at, email_day_before_sent_at, email_hour_before_sent_at, email_live_sent_at, email_recording_sent_at, live_event_presence(first_seen_at)",
        )
        .limit(10000),
    ]);
    if (eventsResult.error || registrationsResult.error) {
      setLoadError((eventsResult.error ?? registrationsResult.error)?.message ?? "Erro ao carregar.");
      return;
    }
    setLoadError(null);
    const next: Record<string, RegistrationCounts> = {};
    for (const row of registrationsResult.data ?? []) {
      const bucket = (next[row.event_id as string] ??= {
        total: 0,
        group: 0,
        whatsapp: 0,
        present: 0,
        sent: { day_before: 0, hour_before: 0, live: 0, recording: 0 },
      });
      bucket.total += 1;
      if (row.group_clicked_at) bucket.group += 1;
      if (row.whatsapp_started_at) bucket.whatsapp += 1;
      const presence = row.live_event_presence as { first_seen_at: string } | { first_seen_at: string }[] | null;
      if (Array.isArray(presence) ? presence.length > 0 : Boolean(presence)) bucket.present += 1;
      if (row.email_day_before_sent_at) bucket.sent.day_before += 1;
      if (row.email_hour_before_sent_at) bucket.sent.hour_before += 1;
      if (row.email_live_sent_at) bucket.sent.live += 1;
      if (row.email_recording_sent_at) bucket.sent.recording += 1;
    }
    setCounts(next);
    setEvents((eventsResult.data as EventRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loadError) {
    return (
      <Alert severity="error" className="neutral bg-background-paper/60!">
        Não foi possível carregar os eventos: {loadError}
      </Alert>
    );
  }
  if (!events) return null;
  if (events.length === 0) {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        Nenhum evento cadastrado. O primeiro vem da migração 0112 — confira se ela foi aplicada neste banco.
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-5">
      {events.map((event) => (
        <EventCard key={event.id} event={event} counts={counts[event.id]} onSaved={refresh} />
      ))}
    </Box>
  );
}

function EventCard({
  event,
  counts,
  onSaved,
}: {
  event: EventRow;
  counts: RegistrationCounts | undefined;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: event.title,
    startsAt: toBrasiliaInput(event.starts_at),
    duration: event.duration_minutes ? String(event.duration_minutes) : "",
    state: event.state,
    ownerPhone: event.owner_phone ? formatMobileBrInput(event.owner_phone) : "",
    groupInvite: event.group_invite_url ?? "",
    stream: event.stream_url ?? "",
    recording: event.recording_url ?? "",
    ipLimit: String(event.ip_window_limit),
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [sending, setSending] = useState<ReminderKind | null>(null);

  const save = async () => {
    setNotice(null);
    const startsAt = fromBrasiliaInput(form.startsAt);
    if (form.state !== "rascunho" && !startsAt) {
      setNotice({ tone: "error", text: "Para sair do rascunho, o evento precisa de data e hora." });
      return;
    }
    let ownerPhone: string | null = null;
    if (form.ownerPhone.trim()) {
      const phone = normalizeMobileBr(form.ownerPhone);
      if (!phone.ok) {
        setNotice({ tone: "error", text: "O número dono precisa ser um celular com DDD (o WhatsApp do MedChina)." });
        return;
      }
      ownerPhone = `55${phone.digits}`;
    }
    const invite = form.groupInvite.trim();
    if (invite && !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(invite)) {
      setNotice({ tone: "error", text: "O convite precisa ser um link https://chat.whatsapp.com/…" });
      return;
    }
    const duration = form.duration.trim() ? Number(form.duration) : null;
    if (duration !== null && (!Number.isInteger(duration) || duration < 15 || duration > 480)) {
      setNotice({ tone: "error", text: "A duração vai de 15 a 480 minutos." });
      return;
    }
    const ipLimit = Number(form.ipLimit);
    if (!Number.isInteger(ipLimit) || ipLimit < 1 || ipLimit > 10000) {
      setNotice({ tone: "error", text: "O limite por rede vai de 1 a 10.000 inscrições por hora." });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("live_events")
      .update({
        title: form.title.trim(),
        starts_at: startsAt,
        duration_minutes: duration,
        state: form.state,
        owner_phone: ownerPhone,
        group_invite_url: invite || null,
        stream_url: form.stream.trim() || null,
        recording_url: form.recording.trim() || null,
        ip_window_limit: ipLimit,
      })
      .eq("id", event.id);
    setSaving(false);
    if (error) {
      setNotice({ tone: "error", text: `Não foi possível salvar: ${error.message}` });
      return;
    }
    // Configuration only — never a person's data.
    recordAudit(supabase, "admin.leads.event_updated", {
      entityType: "live_event",
      entityId: event.id,
      metadata: {
        state: form.state,
        starts_at: startsAt,
        has_owner_phone: Boolean(ownerPhone),
        has_group_invite: Boolean(invite),
        has_stream: Boolean(form.stream.trim()),
        has_recording: Boolean(form.recording.trim()),
      },
    });
    setNotice({ tone: "success", text: "Salvo. A página do evento segue isso na próxima visita." });
    onSaved();
  };

  const send = async (kind: ReminderKind) => {
    setSending(kind);
    setNotice(null);
    const result = await sendLiveEventReminder(event.id, kind);
    setSending(null);
    setNotice({ tone: result.ok ? "success" : "error", text: result.message });
    onSaved();
  };

  const total = counts?.total ?? 0;

  return (
    <Card component="section" aria-labelledby={`event-${event.id}-title`}>
      <CardContent className="flex flex-col gap-5">
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h5" component="h2" id={`event-${event.id}-title`} className="mb-1">
              {event.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Página: <a href={`/${event.slug}`}>/{event.slug}</a>
            </Typography>
          </Box>
          <Chip
            label={STATE_CHIP[event.state]}
            size="small"
            variant="outlined"
            color={event.state === "ao_vivo" ? "success" : "grey"}
          />
        </Box>

        {total > 0 ? (
          <MetricBars
            total={total}
            items={[
              { key: "total", label: "Inscrições", value: total, tone: "primary" },
              { key: "group", label: "Clicaram no grupo de avisos", value: counts?.group ?? 0, tone: "secondary" },
              {
                key: "whatsapp",
                label: "Iniciaram conversa no WhatsApp",
                value: counts?.whatsapp ?? 0,
                tone: "secondary",
                hint: "Prova de que o número é delas — prioridade no 1:1",
              },
              {
                key: "present",
                label: "Assistiram (presença pela página)",
                value: counts?.present ?? 0,
                tone: "attention",
              },
            ]}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Ainda sem inscrições.
          </Typography>
        )}

        <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Título" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
          <SelectField
            label="Estado"
            value={form.state}
            options={STATE_OPTIONS}
            onChange={(value) => setForm({ ...form, state: value as EventState })}
          />
          <Field
            label="Data e hora — horário de Brasília"
            type="datetime-local"
            value={form.startsAt}
            onChange={(value) => setForm({ ...form, startsAt: value })}
          />
          <Field
            label="Duração (minutos, opcional)"
            type="number"
            value={form.duration}
            onChange={(value) => setForm({ ...form, duration: value })}
          />
          {/* The semantic phone field (mask + validation), never a raw input:
              stored as 55 + the 11 digits, never the mask (app-ux rules). The
              theme hides a standard TextField's floating label, so the label
              sits above, like the neighbouring fields, tied by htmlFor/id. */}
          <Box className="flex flex-col">
            <FormLabel htmlFor={`event-owner-phone-${event.id}`}>
              Número dono da Comunidade (WhatsApp do MedChina, com DDD)
            </FormLabel>
            <PhoneField
              id={`event-owner-phone-${event.id}`}
              className="outlined"
              value={form.ownerPhone}
              onChange={(changed) => setForm({ ...form, ownerPhone: changed.target.value })}
              isValid={(value) => normalizeMobileBr(value).ok}
              invalidMessage="Use um celular com DDD — o número precisa receber WhatsApp."
              variant="standard"
              size="small"
              fullWidth
            />
          </Box>
          <Field
            label="Convite da Comunidade (https://chat.whatsapp.com/…)"
            value={form.groupInvite}
            onChange={(value) => setForm({ ...form, groupInvite: value })}
          />
          <Field
            label="Transmissão (link do YouTube não listado)"
            value={form.stream}
            onChange={(value) => setForm({ ...form, stream: value })}
          />
          <Field
            label="Gravação (link do YouTube)"
            value={form.recording}
            onChange={(value) => setForm({ ...form, recording: value })}
          />
          <Field
            label="Inscrições por rede por hora (anti-abuso; folgado por causa do CGNAT)"
            type="number"
            value={form.ipLimit}
            onChange={(value) => setForm({ ...form, ipLimit: value })}
          />
        </Box>

        <Box>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? "Salvando…" : "Salvar evento"}
          </Button>
        </Box>

        <Box className="flex flex-col gap-2">
          <Typography variant="subtitle2" component="h3">
            E-mails do evento
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cada botão envia uma vez para quem se inscreveu com e-mail e não se descadastrou. Apertar de novo só alcança
            quem ainda não recebeu.
          </Typography>
          <Box className="flex flex-row flex-wrap gap-2">
            {REMINDERS.map((reminder) => (
              <Button
                key={reminder.kind}
                variant="outlined"
                color="grey"
                disabled={sending !== null || total === 0}
                onClick={() => send(reminder.kind)}
              >
                {sending === reminder.kind ? "Enviando…" : reminder.label}
                {counts ? ` · ${counts.sent[reminder.kind]} enviados` : ""}
              </Button>
            ))}
          </Box>
        </Box>

        {notice ? (
          <Alert severity={notice.tone} className="neutral bg-background-paper/60!">
            {notice.text}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
