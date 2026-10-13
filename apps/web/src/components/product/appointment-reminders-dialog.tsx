"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiPen from "@/icons/nexture/ni-pen";
import NiPhoneHandset from "@/icons/nexture/ni-phone-handset";
import { calendarDayRange } from "@/lib/agenda";
import { buildReminderRun, type ReminderAppointment } from "@/lib/appointment-reminders";
import { cn } from "@/lib/utils";
import {
  insertWhatsappToken,
  normalizeWhatsappTemplate,
  renderWhatsappTemplate,
  unknownWhatsappTokens,
  WHATSAPP_TEMPLATE_MAX,
  WHATSAPP_TOKENS,
  type WhatsappToken,
} from "@/lib/whatsapp-template";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

/**
 * Tomorrow's reminder run — the lever against no-show, which the agenda has
 * measured all along without offering.
 *
 * There is no automated WhatsApp here (the Meta API needs business
 * verification, template approval and charges per message). So this is an
 * ASSISTED run, and its design follows from that honestly:
 *
 *  - one row per patient, in time order, each with a real anchor that opens
 *    WhatsApp with the message already written — a scripted `window.open` in a
 *    loop would be eaten by the popup blocker and would spray eight tabs at
 *    her anyway;
 *  - opening a row marks it, so a run interrupted at patient four resumes at
 *    four instead of starting over — and the mark is stored, so it survives
 *    closing the dialog;
 *  - the mark says "marcado", never "entregue": the app hands off to WhatsApp
 *    and never learns whether she pressed send. She can unmark it;
 *  - patients with no reachable number are LISTED, not hidden — those are
 *    exactly the ones she has to remember to phone.
 */
export default function AppointmentRemindersDialog({
  open,
  onClose,
  orgId,
  day,
  timezone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  /** The day being reminded about (usually tomorrow). */
  day: Date;
  timezone: string;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [state, setState] = useState<RemoteState<ReminderAppointment[], "load_failed">>(() => remoteLoading());
  const [busyId, setBusyId] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // The product default in the current language. `reminders-message` is an ICU
  // message, and feeding it the token NAMES as values yields exactly the raw
  // template — no duplicated sentence to keep in sync, no brace-escaping.
  const defaultTemplate = t("reminders-message", { name: "{name}", date: "{date}", time: "{time}" });

  /** `null` until the profile is read, so an edit is never started against a guess. */
  const [template, setTemplate] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateStatus, setTemplateStatus] = useState<"saved" | "error" | null>(null);

  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: timezone,
  }).format(day);

  const load = useCallback(async () => {
    if (!orgId || !isSupabaseConfigured) {
      setState(remoteError("load_failed"));
      return;
    }
    setState(remoteLoading());
    const { start, end } = calendarDayRange(day, timezone);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("consultations")
      .select("id, status, scheduled_for, reminder_marked_at, patient_id, patients(full_name, phone)")
      .eq("org_id", orgId)
      .eq("status", "scheduled")
      .gte("scheduled_for", start.toISOString())
      .lt("scheduled_for", end.toISOString())
      .order("scheduled_for");
    if (error) {
      setState(remoteError("load_failed"));
      return;
    }

    const appointments: ReminderAppointment[] = (data ?? []).map((row) => {
      const patient = row.patients as unknown as { full_name?: string; phone?: string | null } | null;
      return {
        id: row.id as string,
        status: row.status as string,
        scheduledFor: row.scheduled_for as string,
        patientName: patient?.full_name ?? "—",
        patientPhone: patient?.phone ?? null,
        reminderMarkedAt: (row.reminder_marked_at as string | null) ?? null,
      };
    });

    setState(remoteSuccess(appointments));
  }, [orgId, day, timezone]);

  /**
   * Her saved wording. Read ONLY when the dialog opens, never on the refresh
   * that follows a mark — marking a row would otherwise reload the profile and
   * throw away a message she had just edited and not yet saved.
   */
  const loadTemplate = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setTemplate(defaultTemplate);
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTemplate(defaultTemplate);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("whatsapp_reminder_template")
      .eq("id", user.id)
      .maybeSingle();
    // A failed read falls back to the product default rather than blocking the
    // run: sending the original wording is a far smaller harm than an evening
    // of reminders she cannot send at all.
    setTemplate((profile?.whatsapp_reminder_template as string | null) ?? defaultTemplate);
    // `defaultTemplate` is derived from `t`, stable for a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveTemplate = template ?? defaultTemplate;

  const messageFor = useCallback(
    (appointment: ReminderAppointment) =>
      renderWhatsappTemplate(effectiveTemplate, {
        name: appointment.patientName.trim().split(" ")[0] ?? "",
        date: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: timezone }).format(
          new Date(appointment.scheduledFor),
        ),
        time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(
          new Date(appointment.scheduledFor),
        ),
      }),
    [effectiveTemplate, locale, timezone],
  );

  // Derived, not stored: every keystroke in the field rebuilds the wa.me links,
  // so what she edits is literally what the next tap will send.
  const run = useMemo(
    () => (state.status === "success" ? buildReminderRun(state.data, messageFor) : undefined),
    [state, messageFor],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Separate from the appointment load so a mark-and-refresh never overwrites
  // an edit in progress; closing the dialog drops the unsaved wording, which is
  // what "this run only" means.
  useEffect(() => {
    if (open) void loadTemplate();
    else {
      setTemplate(null);
      setEditing(false);
      setTemplateStatus(null);
    }
  }, [open, loadTemplate]);

  const setMarked = async (consultationId: string, marked: boolean) => {
    setBusyId(consultationId);
    try {
      const supabase = createClient();
      await supabase.rpc("mark_appointment_reminder", {
        target_consultation: consultationId,
        target_marked: marked,
      });
      await load();
    } catch {
      // The mark is bookkeeping for her own run; a failure here must not stop
      // her from carrying on with the next patient.
    } finally {
      setBusyId(null);
    }
  };

  const saveTemplate = async () => {
    setTemplateStatus(null);
    setSavingTemplate(true);
    try {
      const supabase = createClient();
      const normalized = normalizeWhatsappTemplate(effectiveTemplate);
      const { data, error } = await supabase.rpc("update_whatsapp_reminder_template", {
        // Saving the untouched default stores NULL, so she keeps following the
        // product copy and its translations instead of freezing today's words.
        target_template: normalized === defaultTemplate ? null : normalized,
      });
      setTemplateStatus(!error && (data as { ok?: boolean } | null)?.ok ? "saved" : "error");
    } catch {
      setTemplateStatus("error");
    } finally {
      setSavingTemplate(false);
    }
  };

  const insertToken = (token: WhatsappToken) => {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? effectiveTemplate.length;
    const end = field?.selectionEnd ?? effectiveTemplate.length;
    const { text, caret } = insertWhatsappToken(effectiveTemplate, token, start, end);
    setTemplate(text);
    setTemplateStatus(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  };

  const unknownTokens = unknownWhatsappTokens(effectiveTemplate);
  const isDefaultTemplate = normalizeWhatsappTemplate(effectiveTemplate) === defaultTemplate;

  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogHeader title={t("reminders-title")} closeLabel={t("close")} onClose={onClose} />
      <DialogContent className="flex flex-col gap-3 py-5!">
        <Typography variant="body2" className="text-text-secondary leading-6">
          {t("reminders-subtitle", { day: dayLabel })}
        </Typography>

        {state.status === "loading" && (
          <Box className="flex flex-col gap-2">
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Box>
        )}

        {state.status === "error" && (
          <Alert severity="error" action={<Button onClick={() => void load()}>{t("retry")}</Button>}>
            {t("reminders-load-error")}
          </Alert>
        )}

        {run && run.targets.length === 0 && run.unreachable.length === 0 && (
          <Alert severity="info">{t("reminders-empty")}</Alert>
        )}

        {/* The message, collapsed by default: the job here is sending the run,
            and an editor open on arrival would bury the list it feeds. */}
        {run && (run.targets.length > 0 || run.unreachable.length > 0) && template !== null && (
          <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border px-3 py-2">
            {editing ? (
              <>
                <TextField
                  inputRef={fieldRef}
                  label={t("reminders-message-field")}
                  value={effectiveTemplate}
                  onChange={(event) => {
                    setTemplate(event.target.value.slice(0, WHATSAPP_TEMPLATE_MAX));
                    setTemplateStatus(null);
                  }}
                  multiline
                  minRows={3}
                  size="small"
                />
                <Box className="flex flex-row flex-wrap items-center gap-1.5">
                  <Typography variant="body2" className="text-text-secondary text-xs">
                    {t("whatsapp-template-tokens")}
                  </Typography>
                  {WHATSAPP_TOKENS.map((token) => (
                    <Chip
                      key={token}
                      label={t(`whatsapp-token-${token}`)}
                      size="small"
                      variant="outlined"
                      color="primary"
                      onClick={() => insertToken(token)}
                    />
                  ))}
                </Box>

                {unknownTokens.length > 0 && (
                  <Alert severity="warning" className="neutral bg-background-paper/60!">
                    {t("whatsapp-template-unknown-token", {
                      tokens: unknownTokens.map((token) => `{${token}}`).join(", "),
                    })}
                  </Alert>
                )}
                {templateStatus === "saved" && (
                  <Alert severity="success" className="neutral bg-background-paper/60!">
                    {t("reminders-message-saved")}
                  </Alert>
                )}
                {templateStatus === "error" && (
                  <Alert severity="error" className="neutral bg-background-paper/60!">
                    {t("whatsapp-template-save-error")}
                  </Alert>
                )}

                <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                  {t("reminders-message-scope")}
                </Typography>
                <Box className="flex flex-row flex-wrap items-center gap-2">
                  <Button size="small" variant="text" color="grey" onClick={() => setEditing(false)}>
                    {t("close")}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    disabled={savingTemplate}
                    onClick={() => void saveTemplate()}
                  >
                    {savingTemplate ? t("saving") : t("reminders-message-save-default")}
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="grey"
                    disabled={savingTemplate || isDefaultTemplate}
                    onClick={() => {
                      setTemplate(defaultTemplate);
                      setTemplateStatus(null);
                    }}
                  >
                    {t("whatsapp-template-restore")}
                  </Button>
                </Box>
              </>
            ) : (
              <Box className="flex flex-row flex-wrap items-center gap-2">
                <Typography variant="body2" className="text-text-secondary min-w-0 flex-1 text-xs leading-5">
                  {effectiveTemplate}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  color="primary"
                  startIcon={<NiPen size="tiny" />}
                  onClick={() => setEditing(true)}
                >
                  {t("reminders-message-edit")}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {run && run.targets.length > 0 && (
          <>
            <Typography variant="body2" className="text-text-primary text-xs font-semibold">
              {t("reminders-progress", { pending: run.pendingCount, total: run.targets.length })}
            </Typography>
            <Box className="flex flex-col gap-1.5">
              {run.targets.map((target) => (
                <Box
                  key={target.appointment.id}
                  className={cn(
                    "border-grey-100 flex flex-row flex-wrap items-center gap-2 rounded-2xl border px-3 py-2",
                    target.marked && "bg-grey-100/60",
                  )}
                >
                  <Box className="min-w-0 flex-1">
                    <Typography variant="body2" className="text-text-primary text-sm font-medium">
                      {timeOf(target.appointment.scheduledFor)} · {target.appointment.patientName}
                    </Typography>
                    {target.marked && (
                      <Typography variant="body2" className="text-text-secondary flex items-center gap-1 text-xs">
                        <NiCheckSquare size="tiny" aria-hidden />
                        {t("reminders-marked")}
                      </Typography>
                    )}
                  </Box>

                  {/* A real anchor: the click that leaves for WhatsApp is HERS,
                      so no popup blocker eats it and the device can hand off to
                      the installed app. Marking happens on the same click. */}
                  <Button
                    size="small"
                    variant={target.marked ? "text" : "contained"}
                    color={target.marked ? "grey" : "primary"}
                    href={target.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (!target.marked) void setMarked(target.appointment.id, true);
                    }}
                  >
                    {target.marked ? t("reminders-open-again") : t("reminders-open")}
                  </Button>
                  {target.marked && (
                    <Button
                      size="small"
                      variant="text"
                      color="grey"
                      disabled={busyId === target.appointment.id}
                      onClick={() => void setMarked(target.appointment.id, false)}
                    >
                      {busyId === target.appointment.id ? (
                        <CircularProgress size={14} aria-label={t("loading")} />
                      ) : (
                        t("reminders-unmark")
                      )}
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
          </>
        )}

        {/* Never hidden: a patient with no WhatsApp is the one she must call. */}
        {run && run.unreachable.length > 0 && (
          <Box className="flex flex-col gap-1.5">
            <Typography variant="body2" className="text-text-primary flex items-center gap-1 text-xs font-semibold">
              <NiPhoneHandset size="tiny" aria-hidden />
              {t("reminders-unreachable-title")}
            </Typography>
            {run.unreachable.map((appointment) => (
              <Typography key={appointment.id} variant="body2" className="text-text-secondary text-xs leading-5">
                {timeOf(appointment.scheduledFor)} · {appointment.patientName}
              </Typography>
            ))}
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("reminders-unreachable-hint")}
            </Typography>
          </Box>
        )}

        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("reminders-privacy")}
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
