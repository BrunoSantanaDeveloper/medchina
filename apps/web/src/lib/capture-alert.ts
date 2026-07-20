/**
 * Out-of-band alerting for a capture that stopped while the professional's
 * attention is on the PATIENT, not on the screen (PRD §4.1).
 *
 * A silent failure is the most expensive bug in this product: a session can run
 * for 25 minutes believing it is being recorded. So a capture failure must
 * reach her even when this tab is in the background.
 *
 * Deliberately SILENT. There is a patient in the room: a beep interrupts the
 * therapeutic moment, is audible to her, and would be captured into the very
 * audio being transcribed. An audible cue stays a future opt-in preference.
 */

const DEFAULT_TITLE_MARKER = "⚠";

let originalTitle: string | null = null;

/** Marks the browser tab so a glance at it reveals the failure. */
export function markTabAlert(document: Document, message: string): void {
  if (originalTitle === null) originalTitle = document.title;
  document.title = `${DEFAULT_TITLE_MARKER} ${message}`;
}

/** Restores the tab title captured before the first alert. */
export function clearTabAlert(document: Document): void {
  if (originalTitle === null) return;
  document.title = originalTitle;
  originalTitle = null;
}

/** Test seam: forget the captured title between cases. */
export function resetTabAlertForTests(): void {
  originalTitle = null;
}

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export function notificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

/**
 * Asks for notification permission. Callers must only reach this from a
 * deliberate moment (after a first successful capture) — never on page load,
 * which is the pattern browsers penalise and users reflexively dismiss.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (notificationPermission() === "unsupported") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotificationPermissionState;
  try {
    return (await Notification.requestPermission()) as NotificationPermissionState;
  } catch {
    return "denied";
  }
}

/**
 * Surfaces a capture failure over other windows. `silent` is always true and
 * `renotify` is never set — this must not make noise in a consultation room.
 * Returns whether a notification was actually shown, so the caller can fall
 * back to the in-page alert alone.
 */
export function notifyCaptureFailure(title: string, body: string, tag = "medchina-capture"): boolean {
  if (notificationPermission() !== "granted") return false;
  try {
    const notification = new Notification(title, { body, tag, silent: true, requireInteraction: true });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
