import { buildReminderRun, nextDay, type ReminderAppointment } from "./appointment-reminders";
import { describe, expect, it } from "vitest";

const appointment = (overrides: Partial<ReminderAppointment> = {}): ReminderAppointment => ({
  id: "a1",
  status: "scheduled",
  scheduledFor: "2026-08-04T13:00:00.000Z",
  patientName: "Maria Silva",
  patientPhone: "11987654321",
  reminderMarkedAt: null,
  ...overrides,
});

const message = (item: ReminderAppointment) => `Olá, ${item.patientName}!`;

describe("tomorrow's reminder run", () => {
  it("prepares one prefilled message per reachable patient, in time order", () => {
    const run = buildReminderRun(
      [
        appointment({ id: "late", scheduledFor: "2026-08-04T18:00:00.000Z", patientName: "Ana" }),
        appointment({ id: "early", scheduledFor: "2026-08-04T11:00:00.000Z", patientName: "Bia" }),
      ],
      message,
    );

    expect(run.targets.map((target) => target.appointment.id)).toEqual(["early", "late"]);
    expect(run.targets[0].whatsappUrl).toContain("wa.me/5511987654321");
    expect(run.targets[0].whatsappUrl).toContain(encodeURIComponent("Olá, Bia!"));
  });

  it("only reminds about appointments that are still scheduled", () => {
    const run = buildReminderRun(
      [
        appointment({ id: "ok" }),
        appointment({ id: "cancelled", status: "cancelled" }),
        appointment({ id: "started", status: "in_progress" }),
        appointment({ id: "done", status: "finalized" }),
      ],
      message,
    );

    expect(run.targets.map((target) => target.appointment.id)).toEqual(["ok"]);
  });

  it("surfaces patients with no usable phone instead of dropping them", () => {
    // She has to remember to CALL these — silently omitting them would turn a
    // reminder run into a false sense of completion.
    const run = buildReminderRun(
      [appointment({ id: "reachable" }), appointment({ id: "no-phone", patientPhone: null })],
      message,
    );

    expect(run.targets).toHaveLength(1);
    expect(run.unreachable.map((item) => item.id)).toEqual(["no-phone"]);
  });

  it("separates what she already marked, so an interrupted run resumes", () => {
    const run = buildReminderRun(
      [appointment({ id: "pending" }), appointment({ id: "marked", reminderMarkedAt: "2026-08-03T20:00:00.000Z" })],
      message,
    );

    expect(run.pendingCount).toBe(1);
    expect(run.markedCount).toBe(1);
    // Marked ones stay in the list — hiding them would lose the record of what
    // was done when she reopens the dialog.
    expect(run.targets).toHaveLength(2);
  });

  it("reports an empty run without inventing targets", () => {
    const run = buildReminderRun([], message);
    expect(run).toEqual({ targets: [], unreachable: [], pendingCount: 0, markedCount: 0 });
  });

  it("moves to the next calendar day across a month boundary", () => {
    expect(nextDay(new Date(2026, 7, 31)).getTime()).toBe(new Date(2026, 8, 1).getTime());
    // Leap day, since the reminder run is always "tomorrow".
    expect(nextDay(new Date(2028, 1, 28)).getTime()).toBe(new Date(2028, 1, 29).getTime());
  });
});
