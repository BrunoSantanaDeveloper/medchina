import "server-only";

import { type AllowanceRow, type AudioAllowance, toAllowance } from "@/lib/audio-allowance";
import { notifyUsers } from "@/lib/notifications";
import type { TranscriptResult } from "@flyee/transcribe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Audio minutes: the billable unit of a paid plan and of the Pro trial
 * (PRD §5.4/§5.5/§5.7/§5.8).
 *
 * The allowance itself lives in SQL (`org_audio_allowance`, migration 0024) so
 * the app and the database guard can never disagree about it. This module is
 * the server side of consumption: how much a recording actually cost, writing
 * it to the append-only ledger, and the 80/95/100% alerts.
 *
 * Consumption is recorded ONLY on success. A failed transcription produced
 * nothing the professional can use, so it consumes nothing — the reprocessing
 * policy is still open (PRD §24), and the safe default is not to charge for our
 * own failure.
 */

export type { AudioAllowance };

export async function getAudioAllowance(supabase: SupabaseClient, orgId: string): Promise<AudioAllowance | null> {
  const { data, error } = await supabase.rpc("org_audio_allowance", { target_org: orgId });
  if (error || !data) return null;
  return toAllowance(data as AllowanceRow);
}

/** "12:34" | "1:02:03" | "34" → seconds. Returns 0 for anything unparseable. */
function timestampToSeconds(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * How much audio to bill for, measured on the SERVER.
 *
 * `recordings.duration_seconds` is reported by the browser, so it cannot be the
 * billing figure on its own — a client could claim a 50-minute consultation
 * lasted one second. The transcript gives an independent floor: the last
 * segment's timestamp is audio Gemini demonstrably heard.
 *
 * Taking the MAX of the two is safe in the only direction that matters: a
 * client can inflate its own bill (not a threat) but cannot report below what
 * the audio proves. The floor slightly undercounts (it ignores trailing
 * silence), which favours the customer — the honest way to be wrong.
 */
export function billableSeconds(transcript: TranscriptResult, reportedSeconds: number | null): number {
  const transcriptFloor = (transcript.segments ?? []).reduce(
    (max, segment) => Math.max(max, timestampToSeconds(segment.start ?? "0")),
    0,
  );
  const reported = Number.isFinite(reportedSeconds) && reportedSeconds && reportedSeconds > 0 ? reportedSeconds : 0;
  return Math.max(Math.round(transcriptFloor), Math.round(reported));
}

const THRESHOLDS = [100, 95, 80] as const;

/**
 * Alerts at 80%, 95% and 100% of the allowance (PRD §5.8). Idempotent by
 * construction: `usage_alerts` has a unique (org, window, threshold), so a
 * retried job re-inserts nothing and nobody is notified twice.
 *
 * Best-effort: a failed alert must never fail the consultation that triggered
 * it — the clinical work is what matters.
 */
async function alertOnConsumption(supabase: SupabaseClient, orgId: string, allowance: AudioAllowance) {
  const crossed = THRESHOLDS.find((threshold) => allowance.percent >= threshold);
  if (!crossed || !allowance.windowStart) return;

  const { data: inserted } = await supabase
    .from("usage_alerts")
    .insert({ org_id: orgId, window_start: allowance.windowStart, threshold: crossed })
    .select("id")
    .maybeSingle();

  // Already alerted for this threshold in this window.
  if (!inserted) return;

  const { data: members } = await supabase.from("memberships").select("user_id").eq("org_id", orgId);
  const userIds = (members ?? []).map((row) => row.user_id as string);
  if (userIds.length === 0) return;

  // Stored text, so it is written in the default locale (pt-BR) at creation.
  const isTrial = allowance.source === "trial";
  const reached =
    crossed === 100
      ? isTrial
        ? "Seu teste Pro chegou ao fim dos minutos"
        : "Você usou todos os minutos do ciclo"
      : `Você já usou ${crossed}% dos seus minutos`;
  const body =
    crossed === 100
      ? "Seus pacientes, prontuários e documentos continuam disponíveis. Para gravar e processar novas consultas, escolha um plano."
      : `${allowance.minutesRemaining} de ${allowance.minutesLimit} minutos restantes.`;

  await notifyUsers(userIds, { type: "billing", title: reached, body, href: "/settings/billing" });
}

/**
 * Records what a processed recording consumed and fires any threshold alert.
 * Called by the pipeline AFTER a successful transcription — never before, and
 * never for a failure.
 *
 * The ledger only accepts service-role writes (migration 0024), which is why
 * this runs with the pipeline's client and never from the browser.
 */
export async function recordAudioUsage(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    recordingId: string;
    transcriptionId: string;
    seconds: number;
    createdBy?: string | null;
  },
): Promise<void> {
  if (input.seconds <= 0) return;

  const { error } = await supabase.from("audio_usage").insert({
    org_id: input.orgId,
    recording_id: input.recordingId,
    transcription_id: input.transcriptionId,
    seconds: input.seconds,
    kind: "transcription",
    created_by: input.createdBy ?? null,
  });
  if (error) return;

  const allowance = await getAudioAllowance(supabase, input.orgId);
  if (allowance) await alertOnConsumption(supabase, input.orgId, allowance);
}
