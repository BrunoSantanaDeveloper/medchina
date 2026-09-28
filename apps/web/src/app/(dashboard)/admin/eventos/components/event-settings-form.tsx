"use client";

import { Field, SelectField } from "../../billing/components/catalog-shared";
import { type ConsoleEvent, type EventState, fromBrasiliaInput, STATE_OPTIONS, toBrasiliaInput } from "./event-model";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, FormHelperText, FormLabel, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { PhoneField } from "@/components/product/fields";
import { recordAudit } from "@/lib/audit";
import { eventPath, eventSlugFromPath, isSafeInternalPath, normalizeInternalPath } from "@/lib/live-event-common";
import { type AngleSlug, OFFER_ANGLES } from "@/lib/offer-angles";
import { createClient } from "@flyee/auth/client";
import { formatMobileBrInput, normalizeMobileBr } from "@flyee/fields";

/**
 * Which opening of /assinar the page's call to action lands on: the angle
 * leads the `utm_content` it sends, and /assinar picks the angle by that
 * first word (`resolveAngle`). None: the default opening.
 */
const DEFAULT_ANGLE_OPTION = "padrao";
const ANGLE_OPTIONS = [
  { value: DEFAULT_ANGLE_OPTION, label: "Padrão (abertura geral do /assinar)" },
  ...(Object.keys(OFFER_ANGLES) as AngleSlug[]).map((key) => ({
    value: key,
    label: `${key} · ${OFFER_ANGLES[key].title} ${OFFER_ANGLES[key].accent}`,
  })),
];

const AFTER_OPTIONS = [
  { value: "recording", label: "Mostrar a gravação e a captura curta (“receber a gravação no WhatsApp”)" },
  { value: "redirect", label: "Levar quem visitar para outro endereço do site" },
];

/**
 * How the event RUNS: state, date, the WhatsApp number and the Community, the
 * stream and the recording, the anti-abuse window — and what its page does
 * once it is over, a per-event choice (owner's decision, 2026-09-28): keep the
 * recording with the short capture, or send visitors to another address of
 * the site (the next event, /china, a plan page).
 *
 * The lifecycle is enforced by the database, not only here (migration 0113):
 * the address freezes once the event is published or has a registration; only
 * an empty draft can be deleted; anything else is archived — out of the list,
 * with its page, registrations and results intact.
 */
export default function EventSettingsForm({
  event,
  registrations,
  onSaved,
}: {
  event: ConsoleEvent;
  /** Null while the results are unread — every guard then assumes there are some. */
  registrations: number | null;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    startsAt: toBrasiliaInput(event.starts_at),
    duration: event.duration_minutes ? String(event.duration_minutes) : "",
    state: event.state,
    ownerPhone: event.owner_phone ? formatMobileBrInput(event.owner_phone) : "",
    groupInvite: event.group_invite_url ?? "",
    stream: event.stream_url ?? "",
    recording: event.recording_url ?? "",
    ipLimit: String(event.ip_window_limit),
    endedBehavior: event.ended_behavior,
    redirectPath: event.ended_redirect_path ?? "",
    offerAngle: event.offer_angle ?? DEFAULT_ANGLE_OPTION,
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The same three locks as the database (migration 0113): once published the
  // address has been shared, even if the event went back to draft.
  const slugLocked = Boolean(event.published_at) || event.state !== "rascunho" || registrations !== 0;
  const canDelete = event.state === "rascunho" && !event.published_at && registrations === 0;
  const canArchive = event.state === "rascunho" || event.state === "encerrado";

  const save = async () => {
    setNotice(null);
    const startsAt = fromBrasiliaInput(form.startsAt);
    if (form.state !== "rascunho" && !startsAt) {
      setNotice({ tone: "error", text: "Para sair do rascunho, o evento precisa de data e hora." });
      return;
    }
    if (event.archived_at && form.state !== "rascunho" && form.state !== "encerrado") {
      setNotice({ tone: "error", text: "Desarquive o evento antes de reabrir as inscrições ou colocá-lo no ar." });
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
    const redirectPath = form.redirectPath.trim();
    if (form.endedBehavior === "redirect") {
      if (!isSafeInternalPath(redirectPath)) {
        setNotice({
          tone: "error",
          text: "O endereço de destino é um caminho deste site, começando com “/”, como /china ou /ao-vivo/proximo-evento.",
        });
        return;
      }
      if (normalizeInternalPath(redirectPath) === normalizeInternalPath(eventPath(event.slug))) {
        setNotice({ tone: "error", text: "O destino não pode ser a própria página do evento." });
        return;
      }
      // Another event's page must be one a visitor can land on — the public
      // page skips the redirect otherwise, so saving it would only mislead.
      const targetSlug = eventSlugFromPath(redirectPath);
      if (targetSlug) {
        const { data: target, error: targetError } = await createClient()
          .from("live_events")
          .select("state, ended_behavior")
          .eq("slug", targetSlug)
          .maybeSingle();
        if (targetError) {
          setNotice({ tone: "error", text: `Não foi possível conferir o evento de destino: ${targetError.message}` });
          return;
        }
        if (!target) {
          setNotice({ tone: "error", text: `Não existe evento no endereço ${eventPath(targetSlug)}.` });
          return;
        }
        if (target.state === "rascunho") {
          setNotice({
            tone: "error",
            text: "O evento de destino ainda é rascunho: quem chegasse lá veria uma página inexistente.",
          });
          return;
        }
        if (target.state === "encerrado" && target.ended_behavior === "redirect") {
          setNotice({
            tone: "error",
            text: "O evento de destino também já terminou e leva para outro endereço. Aponte direto para o destino final.",
          });
          return;
        }
      }
    }

    const offerAngle = form.offerAngle === DEFAULT_ANGLE_OPTION ? null : form.offerAngle;

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("live_events")
      .update({
        starts_at: startsAt,
        duration_minutes: duration,
        state: form.state,
        owner_phone: ownerPhone,
        group_invite_url: invite || null,
        stream_url: form.stream.trim() || null,
        recording_url: form.recording.trim() || null,
        ip_window_limit: ipLimit,
        ended_behavior: form.endedBehavior,
        ended_redirect_path: form.endedBehavior === "redirect" ? redirectPath : null,
        offer_angle: offerAngle,
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
        ended_behavior: form.endedBehavior,
        offer_angle: offerAngle,
      },
    });
    setNotice({ tone: "success", text: "Salvo. A página do evento segue isso na próxima visita." });
    onSaved();
  };

  const setArchived = async (archived: boolean) => {
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("live_events")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", event.id);
    if (error) {
      setNotice({ tone: "error", text: `Não foi possível ${archived ? "arquivar" : "desarquivar"}: ${error.message}` });
      return;
    }
    recordAudit(supabase, archived ? "admin.events.archived" : "admin.events.unarchived", {
      entityType: "live_event",
      entityId: event.id,
    });
    setNotice({
      tone: "success",
      text: archived
        ? "Arquivado. A página, as inscrições e os resultados continuam — o evento só sai da lista principal."
        : "Desarquivado.",
    });
    onSaved();
  };

  return (
    <Box className="flex flex-col gap-5">
      <Card component="section" aria-labelledby="config-title">
        <CardContent className="flex flex-col gap-5">
          <Box>
            <Typography variant="h6" component="h2" id="config-title" className="mb-1">
              Como o evento funciona
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Endereço: {eventPath(event.slug)}
              {slugLocked
                ? " — fixo: já foi publicado ou tem inscrições, e está em e-mails, anúncios e QR codes."
                : " — ainda pode mudar enquanto for rascunho sem inscrições (recrie o evento com outro endereço)."}
            </Typography>
          </Box>

          <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <Box className="flex flex-col md:col-span-2">
              <SelectField
                label="Abertura do /assinar no botão da página"
                value={form.offerAngle}
                options={ANGLE_OPTIONS}
                onChange={(value) => setForm({ ...form, offerAngle: value })}
              />
              <FormHelperText>
                A primeira frase que a pessoa lê ao clicar em assinar. Escolha a que continua a conversa do evento.
              </FormHelperText>
            </Box>
          </Box>

          <Box className="flex flex-col gap-3">
            <Typography variant="subtitle2" component="h3">
              Depois que o evento terminar
            </Typography>
            <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SelectField
                label="A página do evento encerrado"
                value={form.endedBehavior}
                options={AFTER_OPTIONS}
                onChange={(value) => setForm({ ...form, endedBehavior: value as "recording" | "redirect" })}
              />
              {form.endedBehavior === "redirect" ? (
                <Box className="flex flex-col">
                  <Field
                    label="Endereço de destino"
                    value={form.redirectPath}
                    onChange={(value) => setForm({ ...form, redirectPath: value })}
                  />
                  <FormHelperText>
                    Um caminho deste site, como /china, /planos ou /ao-vivo/proximo-evento. Você, como superadmin,
                    continua vendo a página com um aviso.
                  </FormHelperText>
                </Box>
              ) : null}
            </Box>
            <Typography variant="body2" color="text.secondary">
              Vale só quando o estado for “Encerrado”. Até lá, a página segue normalmente.
            </Typography>
          </Box>

          {notice ? (
            <Alert severity={notice.tone} className="neutral bg-background-paper/60!">
              {notice.text}
            </Alert>
          ) : null}

          <Box>
            <Button variant="contained" onClick={() => void save()} disabled={saving}>
              {saving ? "Salvando…" : "Salvar configuração"}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="ciclo-title">
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h6" component="h2" id="ciclo-title" className="mb-0">
            Arquivar ou excluir
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Arquivar tira o evento da lista principal e mantém tudo: página, inscrições e resultados. Excluir só existe
            para rascunho que nunca foi publicado e não tem nenhuma inscrição.
          </Typography>
          <Box className="flex flex-row flex-wrap gap-2">
            {event.archived_at ? (
              <Button variant="outlined" color="grey" onClick={() => void setArchived(false)}>
                Desarquivar
              </Button>
            ) : (
              <Button variant="outlined" color="grey" disabled={!canArchive} onClick={() => void setArchived(true)}>
                Arquivar
              </Button>
            )}
            <Button variant="outlined" color="error" disabled={!canDelete} onClick={() => setDeleting(true)}>
              Excluir rascunho
            </Button>
          </Box>
          {!canArchive && !event.archived_at ? (
            <Typography variant="body2" color="text.secondary">
              Um evento com inscrições abertas ou no ar não pode ser arquivado — encerre-o primeiro.
            </Typography>
          ) : null}
        </CardContent>
      </Card>

      {deleting ? (
        <ConfirmActionDialog
          key={event.id}
          title={`Excluir o rascunho “${event.title}”`}
          consequences={["Apaga o evento e o texto da página. O endereço fica livre para outro evento."]}
          stays={["Nenhuma inscrição é afetada: um rascunho excluível não tem nenhuma."]}
          reasonPlaceholder="Ex.: criado por engano"
          confirmLabel="Excluir rascunho"
          tone="danger"
          onConfirm={async (reason) => {
            const { data, error } = await createClient().rpc("delete_live_event", {
              target_event: event.id,
              target_reason: reason,
            });
            const result = (data ?? {}) as { ok?: boolean; code?: string };
            if (error) return error.message;
            if (!result.ok) {
              return result.code === "has_registrations"
                ? "Este evento já tem inscrições: arquive em vez de excluir."
                : result.code === "was_published"
                  ? "Este evento já foi publicado: o endereço pode estar em anúncios e e-mails. Arquive em vez de excluir."
                  : result.code === "not_draft"
                    ? "Só um rascunho pode ser excluído."
                    : "Não foi possível excluir.";
            }
            router.push("/admin/eventos");
            return null;
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </Box>
  );
}
