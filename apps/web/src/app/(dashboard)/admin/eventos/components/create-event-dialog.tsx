"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { aboutEvent, EVENT_CONTENT_LIMITS, eventPath, isEventSlug, slugFromTitle } from "@/lib/live-event-common";
import { createClient } from "@flyee/auth/client";

/**
 * Creating an event, or duplicating one. Both start as a DRAFT: the page
 * answers 404 to everyone but a superadmin until the operator opens the
 * registrations, so an unfinished event can never leak.
 *
 * Only the three things that must exist before anything else are asked here —
 * the title, the address, the topic. The rest (date, page copy, WhatsApp
 * number) is edited on the event's own screen, where it can be previewed.
 */
export default function CreateEventDialog({
  source,
  onClose,
}: {
  /** Duplicate this event (its content and settings, never its registrations). */
  source?: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(source ? `${source.title} (cópia)` : "");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugFromTitle(title);
  const slugOk = isEventSlug(effectiveSlug);
  const titleOk = title.trim().length > 0 && title.trim().length <= EVENT_CONTENT_LIMITS.title;

  const submit = async () => {
    setError(null);
    if (!titleOk) {
      setError("Dê um título ao evento.");
      return;
    }
    if (!slugOk) {
      setError("O endereço usa letras minúsculas, números e hífen, com 3 a 60 caracteres.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    if (source) {
      const { data, error: rpcError } = await supabase.rpc("duplicate_live_event", {
        target_event: source.id,
        target_slug: effectiveSlug,
        target_title: title.trim(),
      });
      const result = (data ?? {}) as { ok?: boolean; code?: string; id?: string };
      setSaving(false);
      if (rpcError || !result.ok || !result.id) {
        setError(
          result.code === "slug_taken"
            ? "Esse endereço já é de outro evento. Escolha outro."
            : "Não foi possível duplicar agora. Tente de novo.",
        );
        return;
      }
      router.push(`/admin/eventos/${result.id}`);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("live_events")
      .insert({ slug: effectiveSlug, title: title.trim(), topic: topic.trim() || null, state: "rascunho" })
      .select("id")
      .single();
    setSaving(false);
    if (insertError || !data) {
      setError(
        insertError?.code === "23505"
          ? "Esse endereço já é de outro evento. Escolha outro."
          : "Não foi possível criar agora. Tente de novo.",
      );
      return;
    }
    // Configuration only — never a person's data.
    recordAudit(supabase, "admin.events.created", {
      entityType: "live_event",
      entityId: data.id as string,
      metadata: { slug: effectiveSlug },
    });
    router.push(`/admin/eventos/${data.id}`);
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{source ? "Duplicar evento" : "Novo evento"}</DialogTitle>
      <DialogContent className="flex flex-col gap-4">
        <Typography variant="body2" color="text.secondary">
          {source
            ? "A cópia leva o texto da página e as configurações. Não leva inscrições, data, transmissão nem gravação. Ela nasce em rascunho."
            : "O evento nasce em rascunho: a página só abre quando você mudar o estado para inscrições abertas."}
        </Typography>

        <FormControl className="outlined" variant="standard" size="small" fullWidth>
          <FormLabel htmlFor="new-event-title">Título</FormLabel>
          <Input
            id="new-event-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            inputProps={{ maxLength: EVENT_CONTENT_LIMITS.title }}
            autoFocus
          />
        </FormControl>

        <FormControl className="outlined" variant="standard" size="small" fullWidth>
          <FormLabel htmlFor="new-event-slug">Endereço da página</FormLabel>
          <Input
            id="new-event-slug"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value.toLowerCase());
            }}
            inputProps={{ maxLength: 60 }}
          />
          <FormHelperText error={Boolean(effectiveSlug) && !slugOk}>
            {slugOk
              ? `A página fica em ${eventPath(effectiveSlug)}. Depois de publicado, o endereço não muda mais.`
              : "Letras minúsculas, números e hífen, de 3 a 60 caracteres."}
          </FormHelperText>
        </FormControl>

        {source ? null : (
          <FormControl className="outlined" variant="standard" size="small" fullWidth>
            <FormLabel htmlFor="new-event-topic">Assunto em poucas palavras (opcional)</FormLabel>
            <Input
              id="new-event-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              inputProps={{ maxLength: EVENT_CONTENT_LIMITS.topic }}
              placeholder="a fertilidade na MTC"
            />
            <FormHelperText>
              Aparece nos e-mails e no WhatsApp:{" "}
              {`“o ao vivo ${aboutEvent({ title: title || "Título", topic: topic || null })}”`}.
            </FormHelperText>
          </FormControl>
        )}

        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={saving || !titleOk || !slugOk}>
          {saving ? "Criando…" : source ? "Duplicar" : "Criar em rascunho"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
