import { whatsappDeepLink } from "@/lib/whatsapp-link";

/**
 * Tomorrow's reminder run (PRD §9.7 — the agenda measures no-show; this is the
 * lever that reduces it).
 *
 * No automated WhatsApp exists in this product, so a "reminder" is a short
 * assisted ritual: the app prepares one message per patient and the
 * professional presses send from her own number, one tap each. What this
 * module owns is deciding WHO is on the list and WHAT the message says — the
 * dialog only renders it.
 *
 * The list is deliberately narrow. Only SCHEDULED appointments (a cancelled or
 * already-started one needs no reminder), only those with a reachable phone,
 * and the ones she already marked are separated out rather than hidden — so a
 * run interrupted halfway can be resumed without her re-reading the whole day.
 */

export type ReminderAppointment = {
  id: string;
  status: string;
  scheduledFor: string;
  patientName: string;
  patientPhone: string | null;
  reminderMarkedAt: string | null;
};

export type ReminderTarget = {
  appointment: ReminderAppointment;
  /**
   * wa.me link with the message prefilled. Never null: an appointment whose
   * phone cannot be reached goes to `unreachable` instead, so the UI never has
   * to render a send button that leads nowhere.
   */
  whatsappUrl: string;
  marked: boolean;
};

export type ReminderRun = {
  targets: ReminderTarget[];
  /** Scheduled appointments with no reachable phone — she still needs to know. */
  unreachable: ReminderAppointment[];
  pendingCount: number;
  markedCount: number;
};

/**
 * Builds the run for one day.
 *
 * `buildMessage` comes from the caller so every string stays in the i18n
 * catalog (this module never formats a date or writes copy).
 */
export function buildReminderRun(
  appointments: ReminderAppointment[],
  buildMessage: (appointment: ReminderAppointment) => string,
): ReminderRun {
  const scheduled = appointments
    .filter((appointment) => appointment.status === "scheduled")
    .slice()
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));

  const targets: ReminderTarget[] = [];
  const unreachable: ReminderAppointment[] = [];

  for (const appointment of scheduled) {
    const whatsappUrl = whatsappDeepLink(appointment.patientPhone, buildMessage(appointment));
    if (!whatsappUrl) {
      // Never silently dropped: a patient with no WhatsApp is exactly the one
      // she has to remember to phone.
      unreachable.push(appointment);
      continue;
    }
    targets.push({ appointment, whatsappUrl, marked: Boolean(appointment.reminderMarkedAt) });
  }

  return {
    targets,
    unreachable,
    pendingCount: targets.filter((target) => !target.marked).length,
    markedCount: targets.filter((target) => target.marked).length,
  };
}

/** The calendar day AFTER the given one, in the practice's own reckoning. */
export function nextDay(day: Date): Date {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  next.setDate(next.getDate() + 1);
  return next;
}
