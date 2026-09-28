"use client";

import { type ReminderKind, sendLiveEventReminder } from "../actions";
import type { EventResults } from "./event-model";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import MetricBars from "@/components/product/metric-bars";

const REMINDERS: { kind: ReminderKind; label: string; when: string }[] = [
  { kind: "day_before", label: "Enviar lembrete da véspera", when: "Na véspera, no fim da tarde" },
  { kind: "hour_before", label: "Enviar lembrete de 1 hora", when: "Uma hora antes de começar" },
  { kind: "live", label: "Enviar “começou”", when: "Quando a sala abrir" },
  { kind: "recording", label: "Enviar gravação", when: "Quando a gravação estiver no link de gravação" },
];

/**
 * The event's e-mails (docs/PAGINA-EVENTO.md §8) — a redundant channel; the
 * WhatsApp group is the main one. Each button sends one kind to everyone
 * eligible, once: the per-kind column on the registration is the fence, so a
 * second press only reaches whoever has not received it yet.
 */
export default function EventEmails({
  eventId,
  endedBehavior,
  registrations,
  sent,
  emailConfigured,
  onSent,
}: {
  eventId: string;
  /** "redirect": the page no longer shows the recording, so the recording e-mail would point at nothing. */
  endedBehavior: "recording" | "redirect";
  /**
   * Null when the results could not be read. The buttons stay ON then: a send
   * is idempotent and the server picks who is eligible, and a failed read at
   * the moment the live starts must not stop the "começou" e-mail.
   */
  registrations: number | null;
  sent: EventResults["emails"] | null;
  emailConfigured: boolean;
  onSent: () => void;
}) {
  const [sending, setSending] = useState<ReminderKind | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const send = async (kind: ReminderKind) => {
    setSending(kind);
    setNotice(null);
    const result = await sendLiveEventReminder(eventId, kind);
    setSending(null);
    setNotice({ tone: result.ok ? "success" : "error", text: result.message });
    onSent();
  };

  return (
    <Card component="section" aria-labelledby="emails-title">
      <CardContent className="flex flex-col gap-5">
        <Box>
          <Typography variant="h6" component="h2" id="emails-title" className="mb-1">
            E-mails do evento
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cada botão envia uma vez para quem se inscreveu com e-mail e não se descadastrou. Apertar de novo só alcança
            quem ainda não recebeu. A confirmação sai sozinha, no momento da inscrição.
          </Typography>
        </Box>

        {sent && registrations ? (
          <MetricBars
            total={registrations}
            items={[
              { key: "confirmation", label: "Confirmação da inscrição", value: sent.confirmation, tone: "primary" },
              { key: "day_before", label: "Lembrete da véspera", value: sent.day_before, tone: "secondary" },
              { key: "hour_before", label: "Lembrete de 1 hora", value: sent.hour_before, tone: "secondary" },
              { key: "live", label: "“Começou”", value: sent.live, tone: "secondary" },
              { key: "recording", label: "Gravação", value: sent.recording, tone: "secondary" },
            ]}
          />
        ) : registrations === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nenhuma inscrição ainda — os envios ficam disponíveis quando alguém se inscrever.
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Não foi possível ler quantos e-mails já saíram. Os botões continuam valendo: cada envio só alcança quem
            ainda não recebeu.
          </Typography>
        )}

        <Box className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REMINDERS.map((reminder) => (
            <Box key={reminder.kind} className="flex flex-col gap-1">
              <Button
                variant="outlined"
                color="grey"
                disabled={
                  sending !== null ||
                  registrations === 0 ||
                  !emailConfigured ||
                  (reminder.kind === "recording" && endedBehavior === "redirect")
                }
                onClick={() => void send(reminder.kind)}
              >
                {sending === reminder.kind ? "Enviando…" : reminder.label}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {reminder.kind === "recording" && endedBehavior === "redirect"
                  ? "Desligado: depois do evento a página leva para outro endereço, então o e-mail apontaria para uma gravação que ninguém vê. Mude em Configuração."
                  : reminder.when}
              </Typography>
            </Box>
          ))}
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
