import { guessColumnMapping, normalizeHeader } from "./mapping";
import { describe, expect, it } from "vitest";

/** field -> the header it claimed, for readable assertions. */
function resolve(headers: string[], kind: "patients" | "history" | "schedule" = "patients") {
  const { mapping, surnameColumn } = guessColumnMapping(headers, kind);
  const named: Record<string, string> = {};
  for (const [field, index] of Object.entries(mapping)) {
    if (typeof index === "number") named[field] = headers[index];
  }
  if (surnameColumn !== undefined) named.surname = headers[surnameColumn];
  return named;
}

/**
 * The incident this file exists for: a practice exported its ATTENDANCES and
 * imported them through the patients door. One line per visit, so three people
 * became eight charts — each stamped with a visit id as her identity.
 */
const ATTENDANCE_SHEET = ["ID Atendimento", "Paciente", "Data", "Profissional", "Procedimento", "Descrição", "Valor"];

describe("attendance sheet read as patients", () => {
  it("refuses the visit id as the patient's identity", () => {
    // external_ref is unique per workspace, is the first matching rule of every
    // later import and is fill-only in the writer: a wrong value there can
    // never be corrected by importing again.
    expect(resolve(ATTENDANCE_SHEET).external_ref).toBeUndefined();
  });

  it("still reads the name, so the row is not silently unusable", () => {
    expect(resolve(ATTENDANCE_SHEET).full_name).toBe("Paciente");
  });
});

describe("attendance sheet read as history — the recovery path", () => {
  const mapped = resolve(ATTENDANCE_SHEET, "history");

  it("offers the text as the record, never the id", () => {
    // A history row is written finalized and frozen. A chart whose entire
    // content is "10234" cannot be edited afterwards.
    expect(mapped.body).toBe("Descrição");
  });

  it("puts the visit id where it belongs", () => {
    expect(mapped.external_ref).toBe("ID Atendimento");
  });

  it("reads who and when", () => {
    expect(mapped.patient_name).toBe("Paciente");
    expect(mapped.date).toBe("Data");
  });
});

describe("document is only claimed by a document header", () => {
  // The document is the ONE field that merges two charts automatically, so a
  // wrong column here writes one patient's data into another's chart.
  it.each(["Alergias", "Cirurgias", "Urgencia", "Alergia a medicamento"])("refuses %s", (header) => {
    expect(resolve(["Paciente", header]).document).toBeUndefined();
  });

  it.each(["CPF", "RG", "Nº RG", "CPF/RG", "Documento", "Doc.", "Identidade", "Documento de Identidade"])(
    "still claims %s",
    (header) => {
      expect(resolve(["Paciente", header]).document).toBe(header);
    },
  );
});

describe("the patient's own identity", () => {
  it("is not the city she lives in", () => {
    // "Cidade do Paciente" contains "paciente" and comes first in the file.
    const mapped = resolve(["Cidade do Paciente", "Paciente", "CPF"]);
    expect(mapped.full_name).toBe("Paciente");
  });

  it.each(["Prontuário", "Código", "Matrícula", "ID"])("accepts %s as the old system's id", (header) => {
    expect(resolve(["Paciente", header]).external_ref).toBe(header);
  });

  it.each(["ID Atendimento", "Cod Procedimento", "ID Convenio", "Número da Sessão", "ID Agendamento"])(
    "refuses %s as the old system's id",
    (header) => {
      expect(resolve(["Paciente", header]).external_ref).toBeUndefined();
    },
  );
});

describe("agenda date", () => {
  it("is not a diagnosis", () => {
    // "Diagnóstico" normalizes to "diagnostico", which contains "dia".
    expect(resolve(["Paciente", "Diagnóstico", "Data", "Hora"], "schedule").date).toBe("Data");
  });

  it("still accepts a column called Dia", () => {
    expect(resolve(["Paciente", "Dia", "Hora"], "schedule").date).toBe("Dia");
  });
});

describe("a legitimate patients sheet is untouched", () => {
  it("maps every field a real export carries", () => {
    const mapped = resolve([
      "Código",
      "Nome",
      "Sobrenome",
      "Data de Nascimento",
      "CPF",
      "Celular",
      "E-mail",
      "Observações",
    ]);
    expect(mapped).toEqual({
      external_ref: "Código",
      full_name: "Nome",
      surname: "Sobrenome",
      birth_date: "Data de Nascimento",
      document: "CPF",
      phone: "Celular",
      email: "E-mail",
      notes: "Observações",
    });
  });

  it("keeps refusing somebody else's data", () => {
    const mapped = resolve(["Nome da Mãe", "Paciente", "Telefone do Responsável", "Celular"]);
    expect(mapped.full_name).toBe("Paciente");
    expect(mapped.phone).toBe("Celular");
  });
});

describe("normalizeHeader", () => {
  it("strips accents and punctuation so matching is stable", () => {
    expect(normalizeHeader("Nº do Prontuário")).toBe("n do prontuario");
  });
});
