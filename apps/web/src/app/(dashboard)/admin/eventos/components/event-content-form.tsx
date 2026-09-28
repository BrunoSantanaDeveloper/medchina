"use client";

import { SelectField } from "../../billing/components/catalog-shared";
import type { ConsoleEvent } from "./event-model";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  Typography,
} from "@mui/material";

import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiPlus from "@/icons/nexture/ni-plus";
import { recordAudit } from "@/lib/audit";
import {
  aboutEvent,
  DEFAULT_BYLINE,
  EVENT_CONTENT_LIMITS as LIMITS,
  eventPath,
  type EventTopic,
  readEventTopics,
  TOPIC_ICON_KEYS,
  TOPIC_ICON_LABELS,
  type TopicIconKey,
} from "@/lib/live-event-common";
import { createClient } from "@flyee/auth/client";

type ContentForm = {
  title: string;
  pageTitle: string;
  topic: string;
  headline: string;
  byline: string;
  lead: string;
  leadAfter: string;
  topics: EventTopic[];
  audienceHeading: string;
  audience: string;
  description: string;
};

function fromEvent(event: ConsoleEvent): ContentForm {
  return {
    title: event.title,
    pageTitle: event.page_title ?? "",
    topic: event.topic ?? "",
    headline: event.headline ?? "",
    byline: event.byline,
    lead: event.lead ?? "",
    leadAfter: event.lead_after ?? "",
    topics: readEventTopics(event.topics),
    audienceHeading: event.audience_heading ?? "",
    audience: event.audience ?? "",
    description: event.description ?? "",
  };
}

function TextInput({
  id,
  label,
  value,
  onChange,
  max,
  rows,
  help,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  rows?: number;
  help?: string;
  placeholder?: string;
}) {
  return (
    <FormControl className="outlined" variant="standard" size="small" fullWidth>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        multiline={Boolean(rows)}
        minRows={rows}
        placeholder={placeholder}
        inputProps={{ maxLength: max }}
      />
      <FormHelperText>
        {help ? `${help} · ` : ""}
        {value.length}/{max}
      </FormHelperText>
    </FormControl>
  );
}

/**
 * What the event's page SAYS (migration 0113): the one template renders these
 * fields, so a new event is copy written here, not a deploy. The draft preview
 * (the link at the top) shows the result before anyone else can.
 *
 * The copy rules of docs/PAGINA-EVENTO.md §4 bind whatever is written here —
 * the (funil) pages are never linted: the AI never "diagnoses"; nothing about
 * a law beyond what the law says; a demonstration uses fictitious data; the
 * congress is never "oficial" or "internacional". A partner has no record of
 * her own (owner's decision): she is named in the byline and the copy.
 */
export default function EventContentForm({ event, onSaved }: { event: ConsoleEvent; onSaved: () => void }) {
  const [form, setForm] = useState<ContentForm>(() => fromEvent(event));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const set = <K extends keyof ContentForm>(key: K, value: ContentForm[K]) => setForm({ ...form, [key]: value });

  const setTopic = (index: number, patch: Partial<EventTopic>) =>
    set(
      "topics",
      form.topics.map((topic, position) => (position === index ? { ...topic, ...patch } : topic)),
    );

  const save = async () => {
    setNotice(null);
    if (!form.title.trim()) {
      setNotice({ tone: "error", text: "O título não pode ficar em branco." });
      return;
    }
    if (!form.byline.trim()) {
      setNotice({ tone: "error", text: "A assinatura não pode ficar em branco." });
      return;
    }
    if (form.topics.some((topic) => !topic.text.trim())) {
      setNotice({ tone: "error", text: "Escreva o texto de cada assunto, ou remova o que ficou vazio." });
      return;
    }

    const next = {
      title: form.title.trim(),
      page_title: form.pageTitle.trim() || null,
      topic: form.topic.trim() || null,
      headline: form.headline.trim() || null,
      byline: form.byline.trim(),
      lead: form.lead.trim() || null,
      lead_after: form.leadAfter.trim() || null,
      topics: form.topics.map((topic) => ({ icon: topic.icon, text: topic.text.trim() })),
      audience_heading: form.audienceHeading.trim() || null,
      audience: form.audience.trim() || null,
      description: form.description.trim() || null,
    };

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("live_events").update(next).eq("id", event.id);
    setSaving(false);
    if (error) {
      setNotice({ tone: "error", text: `Não foi possível salvar: ${error.message}` });
      return;
    }
    // Which fields changed — never their text.
    const before = fromEvent(event);
    const changed = (Object.keys(form) as (keyof ContentForm)[]).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(form[key]),
    );
    recordAudit(supabase, "admin.events.content_updated", {
      entityType: "live_event",
      entityId: event.id,
      metadata: { fields: changed },
    });
    setNotice({ tone: "success", text: "Salvo. A página mostra o texto novo na próxima visita." });
    onSaved();
  };

  return (
    <Card component="section" aria-labelledby="conteudo-title">
      <CardContent className="flex flex-col gap-5">
        <Box>
          <Typography variant="h6" component="h2" id="conteudo-title" className="mb-1">
            O que a página diz
          </Typography>
          <Typography variant="body2" color="text.secondary">
            A página fica em{" "}
            <a href={eventPath(event.slug)} target="_blank" rel="noopener">
              {eventPath(event.slug)}
            </a>
            . Nada de diagnóstico feito pela IA, nada sobre a lei além do que ela diz, e demonstração sempre com dados
            fictícios.
          </Typography>
        </Box>

        <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextInput
            id="content-title"
            label="Título do evento"
            value={form.title}
            onChange={(value) => set("title", value)}
            max={LIMITS.title}
            help="Nos e-mails, no console e — sem o campo ao lado — na aba e na prévia do link"
          />
          <TextInput
            id="content-page-title"
            label="Título da aba e da prévia do link (opcional)"
            value={form.pageTitle}
            onChange={(value) => set("pageTitle", value)}
            max={LIMITS.pageTitle}
            placeholder={form.title || undefined}
            help="Em branco, usa o título do evento"
          />
          <TextInput
            id="content-topic"
            label="Assunto em poucas palavras"
            value={form.topic}
            onChange={(value) => set("topic", value)}
            max={LIMITS.topic}
            placeholder="a Lei 15.345"
            help={`Nos e-mails e no WhatsApp: “o ao vivo ${aboutEvent({ title: form.title || "Título", topic: form.topic || null })}”`}
          />
        </Box>

        <TextInput
          id="content-headline"
          label="Manchete"
          value={form.headline}
          onChange={(value) => set("headline", value)}
          max={LIMITS.headline}
          rows={2}
          help="Em branco, usa o título. Coloque o final entre **asteriscos duplos** para destacá-lo"
        />
        <TextInput
          id="content-byline"
          label="Assinatura"
          value={form.byline}
          onChange={(value) => set("byline", value)}
          max={LIMITS.byline}
          placeholder={DEFAULT_BYLINE}
          help="Numa parceria, cite a convidada aqui: “com Debora Giovanella e …”"
        />
        <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextInput
            id="content-lead"
            label="Texto de abertura"
            value={form.lead}
            onChange={(value) => set("lead", value)}
            max={LIMITS.lead}
            rows={4}
          />
          <TextInput
            id="content-lead-after"
            label="Texto de abertura depois do evento (opcional)"
            value={form.leadAfter}
            onChange={(value) => set("leadAfter", value)}
            max={LIMITS.lead}
            rows={4}
            help="O mesmo texto no passado. Em branco, repete o de cima"
          />
        </Box>

        <Box className="flex flex-col gap-3">
          <Typography variant="subtitle2" component="h3">
            O que a pessoa vai ver (até três assuntos)
          </Typography>
          {form.topics.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Sem assuntos, a seção “O que você vai ver” não aparece na página.
            </Typography>
          ) : null}
          {form.topics.map((topic, index) => (
            <Box key={index} className="grid grid-cols-1 items-start gap-3 md:grid-cols-[220px_1fr_auto]">
              <SelectField
                label={`Ícone do assunto ${index + 1}`}
                value={topic.icon}
                options={TOPIC_ICON_KEYS.map((key) => ({ value: key, label: TOPIC_ICON_LABELS[key] }))}
                onChange={(value) => setTopic(index, { icon: value as TopicIconKey })}
              />
              <TextInput
                id={`content-topic-${index}`}
                label={`Assunto ${index + 1}`}
                value={topic.text}
                onChange={(value) => setTopic(index, { text: value })}
                max={LIMITS.topicText}
              />
              <IconButton
                aria-label={`Remover o assunto ${index + 1}`}
                className="md:mt-7"
                onClick={() =>
                  set(
                    "topics",
                    form.topics.filter((_, position) => position !== index),
                  )
                }
              >
                <NiBinEmpty size="medium" />
              </IconButton>
            </Box>
          ))}
          {form.topics.length < 3 ? (
            <Box>
              <Button
                variant="outlined"
                color="grey"
                startIcon={<NiPlus size="medium" />}
                onClick={() => set("topics", [...form.topics, { icon: "apresentacao", text: "" }])}
              >
                Adicionar assunto
              </Button>
            </Box>
          ) : null}
        </Box>

        <Box className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextInput
            id="content-audience-heading"
            label="Para quem é — título (opcional)"
            value={form.audienceHeading}
            onChange={(value) => set("audienceHeading", value)}
            max={LIMITS.audienceHeading}
            help="Use **asteriscos duplos** para o destaque"
          />
          <TextInput
            id="content-audience"
            label="Para quem é — texto"
            value={form.audience}
            onChange={(value) => set("audience", value)}
            max={LIMITS.audience}
            rows={3}
            help="Em branco, a seção não aparece"
          />
        </Box>

        <TextInput
          id="content-description"
          label="Descrição para compartilhamento"
          value={form.description}
          onChange={(value) => set("description", value)}
          max={LIMITS.description}
          rows={2}
          help="O texto sob o título na prévia do link no WhatsApp"
        />

        {notice ? (
          <Alert severity={notice.tone} className="neutral bg-background-paper/60!">
            {notice.text}
          </Alert>
        ) : null}

        <Box>
          <Button variant="contained" onClick={() => void save()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar texto da página"}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
