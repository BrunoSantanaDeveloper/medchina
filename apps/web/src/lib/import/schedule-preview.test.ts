import { guessColumnMapping } from "./mapping";
import { parseSpreadsheet } from "./parse";
import { buildSchedulePreview, type ExistingAppointment, localNaive, naiveMinutes } from "./schedule-preview";
import type { ExistingPatient } from "./types";
import { describe, expect, it } from "vitest";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-08-07T12:00:00.000Z");

const EXPORT = [
  "Código;Paciente;Data;Hora;Duração;Observação",
  "S-1;Márcia da Silva;10/03/2030;14:30;60;Retorno",
  "S-2;Márcia da Silva;10/03/2030;15:00;50;Conflita com a anterior",
  "S-3;Ana Prado;11/03/2030;08:00;;",
  "S-4;Fulana Inexistente;12/03/2030;09:00;;",
  "S-5;Márcia da Silva;10/03/2019;09:00;;Passado",
  "S-6;Márcia da Silva;13/03/2030;;;Sem hora",
].join("\n");

const patients: ExistingPatient[] = [
  { id: "p-marcia", externalRef: "A-10", document: null, fullName: "Márcia da Silva", birthDate: null },
  { id: "p-ana", externalRef: null, document: null, fullName: "Ana Prado", birthDate: null },
];

function previewFrom(appointments: ExistingAppointment[] = []) {
  const table = parseSpreadsheet(new TextEncoder().encode(EXPORT));
  const { mapping } = guessColumnMapping(table.headers, "schedule");
  return {
    table,
    mapping,
    preview: buildSchedulePreview({
      table,
      mapping,
      dateOrder: "dmy",
      existing: patients,
      appointments,
      timeZone: TZ,
      now: NOW,
    }),
  };
}

describe("wall clock helpers", () => {
  it("reads an instant as the practice sees it, not as UTC", () => {
    // 17:30 UTC is 14:30 in São Paulo — the three hours this import exists to
    // not lose.
    expect(localNaive(new Date("2030-03-10T17:30:00.000Z"), TZ)).toBe("2030-03-10T14:30");
  });

  it("compares naive values against each other", () => {
    expect(naiveMinutes("2030-03-10T15:00") - naiveMinutes("2030-03-10T14:30")).toBe(30);
  });
});

describe("agenda import mapping", () => {
  it("finds the columns an appointment needs", () => {
    const { mapping, table } = previewFrom();
    expect(table.headers[mapping.patient_name ?? -1]).toBe("Paciente");
    expect(table.headers[mapping.date ?? -1]).toBe("Data");
    expect(table.headers[mapping.time ?? -1]).toBe("Hora");
    expect(table.headers[mapping.duration ?? -1]).toBe("Duração");
    expect(table.headers[mapping.note ?? -1]).toBe("Observação");
  });
});

describe("agenda import preview", () => {
  it("books the appointment in her wall clock, with its duration and note", () => {
    const [first] = previewFrom().preview.rows;
    expect(first.action).toBe("create");
    expect(first.normalized).toMatchObject({
      patient_id: "p-marcia",
      local_datetime: "2030-03-10T14:30",
      duration: "60",
      note: "Retorno",
      external_ref: "S-1",
    });
  });

  it("refuses a slot the previous line already took — inside the same file", () => {
    const row = previewFrom().preview.rows[1];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("schedule_conflict");
  });

  it("refuses a slot already on the calendar", () => {
    const row = previewFrom([{ scheduledFor: "2030-03-11T11:00:00.000Z", durationMinutes: 50 }]).preview.rows[2];
    // 11:00 UTC is 08:00 in São Paulo: the same slot as row S-3.
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("schedule_conflict");
  });

  it("refuses an appointment in the past — an agenda is not a history", () => {
    const row = previewFrom().preview.rows[4];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("schedule_in_past");
  });

  it("refuses a line with no time", () => {
    const row = previewFrom().preview.rows[5];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("time_required");
  });

  it("refuses an appointment for somebody who is not here", () => {
    const row = previewFrom().preview.rows[3];
    expect(row.action).toBe("error");
    expect(row.errorCode).toBe("patient_not_found");
  });

  it("falls back to the standard duration when the column is empty", () => {
    const row = previewFrom().preview.rows[2];
    expect(row.normalized.duration).toBe("50");
  });

  it("accepts a time glued to the date column", () => {
    const table = parseSpreadsheet(
      new TextEncoder().encode(["Paciente;Data", "Márcia da Silva;10/03/2030 16:45"].join("\n")),
    );
    const { mapping } = guessColumnMapping(table.headers, "schedule");
    const preview = buildSchedulePreview({
      table,
      mapping,
      dateOrder: "dmy",
      existing: patients,
      appointments: [],
      timeZone: TZ,
      now: NOW,
    });
    expect(preview.rows[0].normalized.local_datetime).toBe("2030-03-10T16:45");
  });

  it("counts what will happen before anything is written", () => {
    expect(previewFrom().preview.summary).toEqual({ create: 2, update: 0, skip: 0, error: 4 });
  });
});
