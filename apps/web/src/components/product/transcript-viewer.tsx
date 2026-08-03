"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import NiCheck from "@/icons/nexture/ni-check";
import NiPlay from "@/icons/nexture/ni-play";
import { ANAMNESIS_BLOCKS } from "@/lib/anamnesis";
import { parseTranscriptResult, type TranscriptSegment, transcriptTimestampSeconds } from "@/lib/transcript";
import { cn } from "@/lib/utils";
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

/**
 * Speakers are diarized as opaque labels ("Speaker 1"), so the tone is derived
 * from the label itself: the SAME speaker keeps the SAME colour for the whole
 * transcript, which is what makes a wall of turns skimmable. Harmonic accents
 * only — never red, which stays reserved for risk (docs/DESIGN.md).
 */
const SPEAKER_TONES = [
  "bg-primary/12 text-primary",
  "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
  "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  "bg-grey-100 text-text-secondary",
] as const;

function speakerTone(speaker: string): string {
  let hash = 0;
  for (const character of speaker) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return SPEAKER_TONES[hash % SPEAKER_TONES.length];
}

/** "Speaker 1" → "S1"; a name → its initials. Falls back to the first glyph. */
function speakerInitials(speaker: string): string {
  const words = speaker.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function dataFromState(state: RemoteState<TranscriptData, "load_failed">) {
  if (state.status === "success") return state.data;
  if ("previous" in state) return state.previous;
  return undefined;
}

/**
 * Review boundary for a generated transcript. Source audio stays private and
 * is exposed through a short-lived URL only while the retention policy allows
 * it. Every mapped field points back to the segment that supplied it.
 *
 * Presented as a DIALOG, not a panel in the sidebar column: reading a
 * consultation transcript and reconciling it against the chart is a focused
 * task that needs width, and inlining a dozen segments in a 20rem column made
 * the page scroll past everything else to reach the tools below it.
 */
export default function TranscriptViewer({
  recordingId,
  transcriptionId,
  consultationId,
  onClose,
  seekTo,
}: {
  recordingId: string;
  transcriptionId: string;
  consultationId: string;
  onClose: () => void;
  /**
   * Arriving from a field's provenance: the excerpt to jump to and play. The
   * `nonce` is what makes a second request for the SAME timestamp still fire.
   */
  seekTo?: { start: string; nonce: number };
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
  const [confirmDeleteAudio, setConfirmDeleteAudio] = useState(false);
  const [highlightedStart, setHighlightedStart] = useState<string | null>(null);
  const seekHandled = useRef<number | null>(null);

  /** Jump from a segment to the chart field it fed — the reason to open this
   *  at all. Closing first puts the field in view instead of behind the modal. */
  const goToField = (blockKey: string, fieldKey: string) => {
    onClose();
    window.setTimeout(() => {
      const field = document.getElementById(`consultation-field-${blockKey}-${fieldKey}`);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
    }, 0);
  };

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

  // The provenance popover promised "ouvir este trecho". Deliver it: scroll the
  // segment into view, mark it, and play. Waits for the first load, because the
  // audio element does not exist until the transcript is on screen.
  useEffect(() => {
    if (!seekTo || seekHandled.current === seekTo.nonce) return;
    const loaded = dataRef.current;
    if (!loaded) return;
    seekHandled.current = seekTo.nonce;
    setHighlightedStart(seekTo.start);
    const index = loaded.segments.findIndex((segment) => segment.start === seekTo.start);
    if (index >= 0) {
      window.setTimeout(() => {
        document.getElementById(`transcript-segment-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }
    void playSegment(seekTo.start);
    // `state` is in the deps so a seek requested before the load completes is
    // honored the moment the transcript arrives.
  }, [seekTo, state]);

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
    if (deletingAudio) return;
    setConfirmDeleteAudio(false);
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
    <Dialog open onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogHeader
        title={t("transcript-title")}
        closeLabel={t("close")}
        onClose={onClose}
        trailing={
          <>
            {data?.validatedAt && (
              <Chip
                size="small"
                icon={<NiCheck size="tiny" />}
                label={t("transcript-validated-chip")}
                className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
              />
            )}
            {data && (
              <Chip size="small" variant="outlined" label={t("transcript-segments", { count: data.segments.length })} />
            )}
          </>
        }
      />
      <DialogContent dividers className="flex flex-col gap-4 py-5!">
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
              // The native player stays: it is the accessible, keyboard-ready
              // control and the seek target for "play this segment". Sticky,
              // because every "ouvir este trecho" seeks THIS element — scrolling
              // it out of view left the playback controls unreachable mid-review.
              <Box className="bg-background-paper sticky top-0 z-10 -mt-1 pt-1 pb-2">
                <Box className="bg-grey-50 border-divider rounded-2xl border p-2">
                  <audio
                    ref={audioRef}
                    src={data.audioUrl}
                    controls
                    controlsList="nodownload"
                    preload="metadata"
                    className="block w-full"
                    aria-label={t("transcript-source-audio")}
                  />
                </Box>
              </Box>
            ) : (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("transcript-audio-unavailable")}
              </Alert>
            )}

            {data.segments.length === 0 ? (
              <Alert severity="info">{t("transcript-empty")}</Alert>
            ) : (
              // A transcript is a CONVERSATION, so it reads as one: each turn is
              // a speaker gutter (stable colour per speaker) beside the line,
              // instead of a stack of identical bordered boxes where every turn
              // looked equally important and the speaker was easy to lose.
              <Box component="ol" className="m-0 flex list-none flex-col gap-1 p-0">
                {data.segments.map((segment, index) => {
                  const links = data.linkedFields[segment.start] ?? [];
                  const previous = index > 0 ? data.segments[index - 1] : null;
                  const startsTurn = previous?.speaker !== segment.speaker;
                  return (
                    <Box
                      component="li"
                      id={`transcript-segment-${index}`}
                      key={`${segment.start}-${index}`}
                      className={cn(
                        "hover:bg-grey-25 flex flex-row gap-3 rounded-2xl px-2 py-1.5 transition-colors",
                        startsTurn && index > 0 && "mt-3",
                        segment.start === highlightedStart && "bg-primary/8 ring-primary/30 ring-1",
                      )}
                    >
                      <Box className="flex w-9 flex-none flex-col items-center gap-1">
                        {startsTurn ? (
                          <span
                            aria-hidden
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                              speakerTone(segment.speaker),
                            )}
                          >
                            {speakerInitials(segment.speaker)}
                          </span>
                        ) : (
                          <span aria-hidden className="bg-grey-100 mt-1 h-full w-px flex-none rounded-full" />
                        )}
                      </Box>

                      <Box className="flex min-w-0 flex-1 flex-col gap-1">
                        {startsTurn && (
                          <Typography variant="subtitle2" className="text-text-primary leading-tight">
                            {segment.speaker}
                          </Typography>
                        )}
                        <Typography variant="body2" className="text-text-primary leading-6">
                          {segment.text}
                        </Typography>
                        <Box className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="tiny"
                            variant="text"
                            color="grey"
                            startIcon={<NiPlay size="tiny" />}
                            disabled={!data.audioUrl}
                            onClick={() => void playSegment(segment.start)}
                            aria-label={t("transcript-play-segment", { time: segment.start })}
                            className="px-1! font-mono tabular-nums"
                          >
                            {segment.start}
                          </Button>
                          {links.map((field) => (
                            <Chip
                              key={`${field.blockKey}.${field.fieldKey}`}
                              size="small"
                              clickable
                              label={t(field.labelKey)}
                              title={t("transcript-linked-fields")}
                              className="bg-primary/10 text-primary-dark dark:text-primary-light text-xs font-semibold"
                              onClick={() => goToField(field.blockKey, field.fieldKey)}
                            />
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            {/* The EXPLANATION of each act stays with the content it describes;
                the act itself moved to the footer. */}
            {!data.validatedAt && (
              <Typography
                variant="body2"
                className="text-text-secondary border-divider border-t pt-4 text-xs leading-5"
              >
                {t("transcript-validation-help")}
              </Typography>
            )}
            {data.validatedAt && data.audioUrl && (
              <Typography
                variant="body2"
                className="text-text-secondary border-divider border-t pt-4 text-xs leading-5"
              >
                {t("transcript-delete-audio-help")}
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      {/* A transcript runs dozens of turns; "Validar" at the end of the content
          meant scrolling the whole conversation to reach it. Pinned in the
          footer it is reachable from anywhere in the review. */}
      <DialogActions className="flex flex-row flex-wrap justify-end gap-2">
        <Button color="grey" onClick={onClose}>
          {t("close")}
        </Button>
        {data && data.validatedAt && data.audioUrl && (
          <Button color="grey" variant="outlined" onClick={() => setConfirmDeleteAudio(true)} disabled={deletingAudio}>
            {deletingAudio ? t("transcript-deleting-audio") : t("transcript-delete-audio")}
          </Button>
        )}
        {data && !data.validatedAt && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => void validate()}
            disabled={validating || data.segments.length === 0}
          >
            {validating ? t("transcript-validating") : t("transcript-validate")}
          </Button>
        )}
      </DialogActions>

      {/* Deleting the source audio is irreversible — it gets its own dialog
          naming the consequence, never a browser popup. */}
      <Dialog open={confirmDeleteAudio} onClose={() => setConfirmDeleteAudio(false)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={t("transcript-delete-audio")}
          closeLabel={t("close")}
          onClose={() => setConfirmDeleteAudio(false)}
        />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("transcript-delete-audio-confirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmDeleteAudio(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={() => void deleteAudio()} disabled={deletingAudio}>
            {t("transcript-delete-audio")}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
