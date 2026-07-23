export type CommandConsultationStatus = "scheduled" | "draft" | "in_progress" | "awaiting_review";

export type CommandConsultationRow = {
  id: string;
  status: string;
  scheduled_for: string | null;
  updated_at: string;
};

export type CommandConsultationKind = "review" | "continue" | "upcoming";

export function selectContextConsultations<T extends CommandConsultationRow>(
  rows: T[],
  nowIso = new Date().toISOString(),
): { kind: CommandConsultationKind; consultation: T }[] {
  const newestFirst = (a: T, b: T) => b.updated_at.localeCompare(a.updated_at);
  const scheduledFirst = (a: T, b: T) => (a.scheduled_for ?? "9999").localeCompare(b.scheduled_for ?? "9999");

  const review = rows.filter((row) => row.status === "awaiting_review").sort(newestFirst)[0];
  const continuation = rows
    .filter((row) => row.status === "draft" || row.status === "in_progress")
    .sort(newestFirst)[0];
  const upcoming = rows
    .filter((row) => row.status === "scheduled" && Boolean(row.scheduled_for) && row.scheduled_for! >= nowIso)
    .sort(scheduledFirst)[0];

  return [
    review ? { kind: "review" as const, consultation: review } : null,
    continuation ? { kind: "continue" as const, consultation: continuation } : null,
    upcoming ? { kind: "upcoming" as const, consultation: upcoming } : null,
  ].filter((entry): entry is { kind: CommandConsultationKind; consultation: T } => entry !== null);
}
