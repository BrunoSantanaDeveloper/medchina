"use server";

import { recordAudit } from "@/lib/audit";
import { type LiveEventEmailResult, sendLiveEventEmails } from "@/lib/live-event-email";
import { createClient } from "@flyee/auth/server";
import { isEmailConfigured } from "@flyee/email";
import { isInngestConfigured, sendEvent } from "@flyee/jobs";

export type ReminderKind = "day_before" | "hour_before" | "live" | "recording";

const REMINDER_KINDS: ReminderKind[] = ["day_before", "hour_before", "live", "recording"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireSuperadmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, message: "Sua sessão expirou. Entre de novo." };
  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  if (!profile?.is_superadmin) return { supabase, ok: false as const, message: "Área restrita aos superadmins." };
  return { supabase, ok: true as const };
}

/** What the console must warn about before anyone presses a send button. */
export async function getEventsConsoleStatus(): Promise<{ emailConfigured: boolean; queueConfigured: boolean }> {
  const gate = await requireSuperadmin();
  if (!gate.ok) return { emailConfigured: false, queueConfigured: false };
  return { emailConfigured: isEmailConfigured, queueConfigured: isInngestConfigured };
}

/**
 * One kind of reminder to every eligible registration of an event
 * (docs/PAGINA-EVENTO.md §8). Queued on Inngest; when the queue cannot take it
 * (sendEvent never throws), sent inline — both paths are idempotent through the
 * `email_<kind>_sent_at` columns, so a double click never sends twice.
 */
export async function sendLiveEventReminder(
  eventId: string,
  kind: ReminderKind,
): Promise<{ ok: boolean; message: string; queued?: boolean; result?: LiveEventEmailResult }> {
  const gate = await requireSuperadmin();
  if (!gate.ok) return { ok: false, message: gate.message };
  if (!UUID.test(eventId) || !REMINDER_KINDS.includes(kind)) return { ok: false, message: "Pedido inválido." };
  if (!isEmailConfigured) {
    return { ok: false, message: "O envio de e-mail não está configurado (RESEND_API_KEY). Nada foi enviado." };
  }
  if (kind === "recording") {
    // The same guard as the screen: an ended event that redirects shows no
    // recording, so this e-mail would promise a page nobody can see.
    const { data: event } = await gate.supabase
      .from("live_events")
      .select("ended_behavior")
      .eq("id", eventId)
      .maybeSingle();
    if (event?.ended_behavior === "redirect") {
      return {
        ok: false,
        message: "A página deste evento leva para outro endereço depois do fim: o e-mail da gravação não foi enviado.",
      };
    }
  }

  const queued = await sendEvent("medchina/live-event.email", { eventId, kind });
  await recordAudit(gate.supabase, "admin.leads.event_email", {
    entityType: "live_event",
    entityId: eventId,
    metadata: { kind, queued: queued.sent },
  });
  if (queued.sent) {
    return { ok: true, queued: true, message: "Envio na fila. Os contadores sobem em alguns minutos." };
  }

  const result = await sendLiveEventEmails({ eventId, kind });
  return {
    ok: result.failed === 0,
    queued: false,
    result,
    message:
      result.failed === 0
        ? `Enviados: ${result.sent}. Sem e-mail ou descadastrados: ${result.skipped}.`
        : `Enviados: ${result.sent}. Falharam: ${result.failed} — aperte de novo para tentar só os que faltam.`,
  };
}
