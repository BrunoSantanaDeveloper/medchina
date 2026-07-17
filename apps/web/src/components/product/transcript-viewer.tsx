"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Typography,
} from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiPlay from "@/icons/nexture/ni-play";
import { ANAMNESIS_BLOCKS } from "@/lib/anamnesis";
import { parseTranscriptResult, type TranscriptSegment, transcriptTimestampSeconds } from "@/lib/transcript";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type FieldLink = {
  blockKey: string;
  fieldKey: string;
  labelKey: string;
};

type TranscriptData = {
  language: string;
  segments: TranscriptSegment[];
  linkedFields: Record<string, FieldLink[]>;
  validatedAt: string | null;
  audioUrl: string | null;
};

type ApiTranscription = {
  id: string;
  status: string;
  result: unknown;
  validated_at: string | null;
  audio_path: string | null;
};

const FIELD_LABELS: ReadonlyMap<string, string> = new Map(
  ANAMNESIS_BLOCKS.flatMap((block) => block.fields.map((field) => [`${block.key}.${field.key}`, field.label] as const)),
);

function dataFromState(state: RemoteState<TranscriptData, "load_failed">) {
  if (state.status === "success") return state.data;
  if ("previous" in state) return state.previous;
  return undefined;
}

/** Review boundary for a generated transcript. Source audio stays private and
 * is exposed through a short-lived URL only while the retention policy allows
 * it. Every mapped field points back to the segment that supplied it. */
export default function TranscriptViewer({
  recordingId,
  transcriptionId,
  consultationId,
}: {
  recordingId: string;
  transcriptionId: string;
  consultationId: string;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const audioRef = useRef<HTMLAudioElement>(null);
  const dataRef = useRef<TranscriptData | undefined>(undefined);
  const [state, setState] = useState<RemoteState<TranscriptData, "load_failed">>(() => remoteLoading());
  const [validating, setValidating] = useState(false);
  const [deletingAudio, setDeletingAudio] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [validatedNow, setValidatedNow] = useState(false);
  const [audioDeletedNow, setAudioDeletedNow] = useState(false);

  const load = useCallback(
    async (preservePrevious = true) => {
      const previous = preservePrevious ? dataRef.current : undefined;
      setState(remoteLoading(previous));
      try {
        const response = await fetch(`/api/transcriptions/${transcriptionId}`);
        const body = (await response.json().catch(() => null)) as { transcription?: ApiTranscription } | null;
        if (!response.ok || !body?.transcription) throw new Error("load_failed");

        const parsed = parseTranscriptResult(body.transcription.result);
        const supabase = createClient();
        const { data: answers, error: answersError } = await supabase
          .from("anamnesis_answers")
          .select("block_key, field_key, provenance")
          .eq("consultation_id", consultationId);
        if (answersError) throw new Error("load_failed");

        const linkedFields: Record<string, FieldLink[]> = {};
        for (const answer of answers ?? []) {
          const provenance = answer.provenance as { start?: unknown } | null;
          if (typeof provenance?.start !== "string") continue;
          const composite = `${answer.block_key}.${answer.field_key}`;
          const labelKey = FIELD_LABELS.get(composite);
          if (!labelKey) continue;
          const current = linkedFields[provenance.start] ?? [];
          if (!current.some((field) => field.blockKey === answer.block_key && field.fieldKey === answer.field_key)) {
            current.push({ blockKey: answer.block_key, fieldKey: answer.field_key, labelKey });
          }
          linkedFields[provenance.start] = current;
        }

        let audioUrl: string | null = null;
        if (body.transcription.audio_path) {
          const audioResponse = await fetch(`/api/recordings/${recordingId}/audio`);
          if (audioResponse.ok) {
            const audioBody = (await audioResponse.json().catch(() => null)) as { url?: string } | null;
            audioUrl = audioBody?.url ?? null;
          }
        }

        const next: TranscriptData = {
          language: parsed.language,
          segments: parsed.segments,
          linkedFields,
          validatedAt: body.transcription.validated_at,
          audioUrl,
        };
        dataRef.current = next;
        setState(remoteSuccess(next));
      } catch {
        setState(remoteError("load_failed", previous));
      }
    },
    [consultationId, recordingId, transcriptionId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const playSegment = async (start: string) => {
    if (!audioRef.current) return;
    setActionError(false);
    audioRef.current.currentTime = transcriptTimestampSeconds(start);
    try {
      await audioRef.current.play();
    } catch {
      setActionError(true);
    }
  };

  const validate = async () => {
    if (validating) return;
    setValidating(true);
    setActionError(false);
    setValidatedNow(false);
    try {
      const response = await fetch(`/api/transcriptions/${transcriptionId}/validate`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (!response.ok || !body?.ok) throw new Error("validation_failed");
      setValidatedNow(true);
      await load(true);
    } catch {
      setActionError(true);
    } finally {
      setValidating(false);
    }
  };

  const deleteAudio = async () => {
    if (deletingAudio || !window.confirm(t("transcript-delete-audio-confirm"))) return;
    setDeletingAudio(true);
    setActionError(false);
    setAudioDeletedNow(false);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/audio`, { method: "DELETE" });
      if (!response.ok) throw new Error("audio_deletion_failed");
      setAudioDeletedNow(true);
      await load(true);
    } catch {
      setActionError(true);
    } finally {
      setDeletingAudio(false);
    }
  };

  const data = dataFromState(state);
  const initialLoading = state.status === "loading" && !data;
  const refreshing = state.status === "loading" && Boolean(data);
  const failed = state.status === "error";

  return (
    <Accordion
      id={`transcription-${transcriptionId}`}
      elevation={0}
      disableGutters
      className="border-divider bg-background-paper w-full rounded-2xl! border"
    >
      <AccordionSummary expandIcon={<NiChevronDownSmall />}>
        <Box className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Typography component="h3" variant="subtitle2">
            {t("transcript-title")}
          </Typography>
          {data?.validatedAt && (
            <Chip size="small" color="success" icon={<NiCheck size="tiny" />} label={t("transcript-validated-chip")} />
          )}
          {data && (
            <Chip size="small" variant="outlined" label={t("transcript-segments", { count: data.segments.length })} />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails className="flex flex-col gap-4 pt-0!">
        {initialLoading && <CircularProgress size={22} aria-label={t("loading")} />}
        {failed && !data && (
          <Alert severity="error" action={<Button onClick={() => void load(false)}>{t("retry")}</Button>}>
            {t("transcript-load-error")}
          </Alert>
        )}
        {data && (
          <>
            {failed && (
              <Alert severity="error" action={<Button onClick={() => void load(true)}>{t("retry")}</Button>}>
                {t("transcript-load-error")}
              </Alert>
            )}
            {actionError && <Alert severity="error">{t("transcript-action-error")}</Alert>}
            {validatedNow && <Alert severity="success">{t("transcript-validation-success")}</Alert>}
            {audioDeletedNow && <Alert severity="success">{t("transcript-delete-audio-success")}</Alert>}
            <Box className="flex flex-wrap items-center gap-2" aria-busy={refreshing}>
              {data.language && (
                <Chip size="small" variant="outlined" label={t("transcript-language", { language: data.language })} />
              )}
              {data.validatedAt && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("transcript-validated", {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                      new Date(data.validatedAt),
                    ),
                  })}
                </Typography>
              )}
              {refreshing && <CircularProgress size={16} aria-label={t("loading")} />}
            </Box>

            {data.audioUrl ? (
              <audio
                ref={audioRef}
                src={data.audioUrl}
                controls
                controlsList="nodownload"
                preload="metadata"
                className="w-full"
                aria-label={t("transcript-source-audio")}
              />
            ) : (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("transcript-audio-unavailable")}
              </Alert>
            )}

            {data.segments.length === 0 ? (
              <Alert severity="info">{t("transcript-empty")}</Alert>
            ) : (
              <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
                {data.segments.map((segment, index) => {
                  const links = data.linkedFields[segment.start] ?? [];
                  return (
                    <Box
                      component="li"
                      key={`${segment.start}-${index}`}
                      className="border-divider flex flex-col gap-2 rounded-2xl border p-3"
                    >
                      <Box className="flex flex-wrap items-center gap-2">
                        <Typography variant="subtitle2">{segment.speaker}</Typography>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<NiPlay size="tiny" />}
                          disabled={!data.audioUrl}
                          onClick={() => void playSegment(segment.start)}
                          aria-label={t("transcript-play-segment", { time: segment.start })}
                        >
                          {segment.start}
                        </Button>
                      </Box>
                      <Typography variant="body2" className="leading-6">
                        {segment.text}
                      </Typography>
                      {links.length > 0 && (
                        <Box className="flex flex-wrap items-center gap-2">
                          <Typography variant="caption" className="text-text-secondary">
                            {t("transcript-linked-fields")}
                          </Typography>
                          {links.map((field) => (
                            <a
                              key={`${field.blockKey}.${field.fieldKey}`}
                              href={`#consultation-field-${field.blockKey}-${field.fieldKey}`}
                              className="bg-primary/10 text-primary-dark dark:text-primary-light rounded-full px-2.5 py-1 text-xs font-semibold"
                            >
                              {t(field.labelKey)}
                            </a>
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}

            {!data.validatedAt && (
              <Box className="border-divider flex flex-col items-start gap-2 border-t pt-4">
                <Typography variant="body2" className="text-text-secondary">
                  {t("transcript-validation-help")}
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => void validate()}
                  disabled={validating || data.segments.length === 0}
                >
                  {validating ? t("transcript-validating") : t("transcript-validate")}
                </Button>
              </Box>
            )}
            {data.validatedAt && data.audioUrl && (
              <Box className="border-divider flex flex-col items-start gap-2 border-t pt-4">
                <Typography variant="body2" className="text-text-secondary">
                  {t("transcript-delete-audio-help")}
                </Typography>
                <Button color="grey" variant="outlined" onClick={() => void deleteAudio()} disabled={deletingAudio}>
                  {deletingAudio ? t("transcript-deleting-audio") : t("transcript-delete-audio")}
                </Button>
              </Box>
            )}
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
