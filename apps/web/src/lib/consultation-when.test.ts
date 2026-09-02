import { CONSULTATION_ORDER, consultationWhen, legacyExcerpt } from "./consultation-when";
import { describe, expect, it } from "vitest";

/**
 * The bug these cases exist for: the continuity layer ORDERED consultations by
 * `created_at` and DISPLAYED `started_at`. For a practice that migrated its
 * history the two disagree by years — every imported row shares the instant of
 * the import — so "a consulta anterior" pointed at an arbitrary row of the
 * batch and labelled it with a real date from a different visit.
 */
describe("when a consultation happened", () => {
  it("prefers the moment the appointment actually took place", () => {
    expect(
      consultationWhen({
        startedAt: "2019-03-12T14:00:00Z",
        scheduledFor: "2019-03-12T13:00:00Z",
        createdAt: "2026-09-01T10:00:00Z",
      }),
    ).toBe("2019-03-12T14:00:00Z");
  });

  it("falls back to the scheduled slot for a visit that was never started", () => {
    expect(
      consultationWhen({ startedAt: null, scheduledFor: "2026-09-10T09:00:00Z", createdAt: "2026-09-01T10:00:00Z" }),
    ).toBe("2026-09-10T09:00:00Z");
  });

  it("falls back to the row's own timestamp only when nothing else is known", () => {
    expect(consultationWhen({ startedAt: null, scheduledFor: null, createdAt: "2026-09-01T10:00:00Z" })).toBe(
      "2026-09-01T10:00:00Z",
    );
    expect(consultationWhen({})).toBeNull();
  });

  it("keeps NULLs out of the top of a newest-first list", () => {
    // In a descending order Postgres puts NULLs FIRST by default, which would
    // rank a consultation with no started_at above every real visit.
    const [primary] = CONSULTATION_ORDER;
    expect(primary.column).toBe("started_at");
    expect(primary.ascending).toBe(false);
    expect(primary.nullsFirst).toBe(false);
  });
});

describe("a record migrated from another system", () => {
  it("is passed through whole when it is short enough", () => {
    expect(legacyExcerpt("Acupuntura VB20, IG4. Melhora da cefaleia.", 400)).toBe(
      "Acupuntura VB20, IG4. Melhora da cefaleia.",
    );
  });

  it("is truncated so one long import cannot eat the whole prompt budget", () => {
    const excerpt = legacyExcerpt("a".repeat(3000), 1200);
    expect(excerpt).toHaveLength(1201); // 1200 + the ellipsis
    expect(excerpt?.endsWith("…")).toBe(true);
  });

  it("treats a blank body as no record at all, never as an empty one", () => {
    expect(legacyExcerpt(null, 400)).toBeNull();
    expect(legacyExcerpt("   \n  ", 400)).toBeNull();
  });
});
