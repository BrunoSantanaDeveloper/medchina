import { buildPatientExport, exportFileName, type PatientExportRows } from "./patient-export";
import { describe, expect, it } from "vitest";

const rows: PatientExportRows = {
  patient: {
    id: "patient-1",
    full_name: "Márcia da Silva",
    birth_date: "1985-04-03",
    document: "52998224725",
    email: null,
    phone: "11999990000",
    notes: "",
    alerts: [{ label: "Anticoagulante", severity: "high" }, "Gestante", { severity: "low" }],
    external_ref: "A-10",
    created_at: "2026-01-10T12:00:00.000Z",
    archived_at: null,
  },
  consultations: [
    {
      id: "c-new",
      status: "finalized",
      started_at: "2026-05-02T14:00:00.000Z",
      finalized_at: "2026-05-02T15:00:00.000Z",
      scheduled_for: null,
      chief_complaint: "Insônia",
      summary: null,
      legacy_body: null,
      legacy_source: null,
    },
    {
      id: "c-old",
      status: "finalized",
      started_at: "2024-03-01T13:00:00.000Z",
      finalized_at: null,
      scheduled_for: null,
      chief_complaint: null,
      summary: null,
      legacy_body: "Queixa: lombalgia. Conduta: BL23.",
      legacy_source: "Sistema Anterior",
    },
  ],
  answers: [
    {
      consultation_id: "c-new",
      block_key: "complaint",
      field_key: "onset",
      value: "Há 3 meses",
      source: "patient_report",
      state: "clear",
    },
    {
      consultation_id: "c-new",
      block_key: "tongue",
      field_key: "coating",
      value: "Saburra branca",
      source: "professional_voice",
      state: "clear",
    },
  ],
  addenda: [
    {
      consultation_id: "c-new",
      body: "Correção da data",
      reason: "erro de digitação",
      created_at: "2026-05-03T10:00:00.000Z",
    },
  ],
  hypotheses: [
    {
      consultation_id: "c-new",
      pattern: "Deficiência de Yin do Coração",
      correspondence: "moderate",
      status: "accepted",
    },
  ],
  plans: [
    {
      consultation_id: "c-new",
      status: "validated",
      modalities: { acupuntura: {}, moxabustao: {} },
      validated_at: "2026-05-02T15:30:00.000Z",
    },
  ],
  attachments: [
    {
      consultation_id: "c-new",
      kind: "document",
      mime: "application/pdf",
      caption: "Exame de sangue",
      created_at: "2026-05-02T14:20:00.000Z",
    },
  ],
  documents: [
    {
      consultation_id: "c-new",
      kind: "therapeutic-plan",
      title: "Plano terapêutico",
      version: 2,
      status: "revoked",
      issued_at: "2026-05-02T16:00:00.000Z",
      created_at: "2026-05-02T15:59:00.000Z",
    },
  ],
  consents: [
    {
      accepted_at: "2026-05-01T09:00:00.000Z",
      revoked_at: null,
      consent_terms: { slug: "audio-recording", version: 1 },
    },
    {
      accepted_at: "2026-05-01T09:00:00.000Z",
      revoked_at: "2026-06-01T09:00:00.000Z",
      consent_terms: { slug: "ai-processing", version: 2 },
    },
  ],
};

describe("patient export payload", () => {
  const result = buildPatientExport(rows, "2026-08-07T12:00:00.000Z");

  it("declares a versioned format — it is a contract with whatever system she moves to", () => {
    expect(result.format).toBe("medchina.patient-export");
    expect(result.version).toBe(1);
    expect(result.generatedAt).toBe("2026-08-07T12:00:00.000Z");
  });

  it("reads forwards: the oldest consultation first, the way a chart is read", () => {
    expect(result.consultations.map((consultation) => consultation.id)).toEqual(["c-old", "c-new"]);
  });

  it("keeps each answer with its own consultation and its provenance", () => {
    const [, recent] = result.consultations;
    expect(recent.answers).toHaveLength(2);
    expect(recent.answers[1]).toMatchObject({
      blockKey: "tongue",
      fieldKey: "coating",
      source: "professional_voice",
    });
    expect(result.consultations[0].answers).toEqual([]);
  });

  it("carries the whole record, not just the visit list", () => {
    const [, recent] = result.consultations;
    expect(recent.addenda[0].body).toBe("Correção da data");
    expect(recent.hypotheses[0].pattern).toBe("Deficiência de Yin do Coração");
    expect(recent.plan).toMatchObject({ status: "validated", modalities: ["acupuntura", "moxabustao"] });
    expect(recent.attachments[0].caption).toBe("Exame de sangue");
    // A superseded document stays in the export: it exists in the world, and
    // 0006 revokes instead of deleting exactly so the history stays true.
    expect(recent.documents[0]).toMatchObject({
      version: 2,
      status: "revoked",
      issuedAt: "2026-05-02T16:00:00.000Z",
    });
  });

  it("keeps an imported record whole instead of pretending it is structured data", () => {
    const [legacy] = result.consultations;
    expect(legacy.legacy).toEqual({ body: "Queixa: lombalgia. Conduta: BL23.", source: "Sistema Anterior" });
    expect(result.consultations[1].legacy).toBeNull();
  });

  it("never exports an empty string as if it were an answer", () => {
    expect(result.patient.notes).toBeNull();
    expect(result.patient.email).toBeNull();
  });

  it("normalizes alerts written both ways and drops the unusable one", () => {
    expect(result.patient.alerts).toEqual([{ label: "Anticoagulante", severity: "high" }, { label: "Gestante" }]);
  });

  it("flattens consents with the state that matters — granted, and whether it was revoked", () => {
    expect(result.consents).toEqual([
      { slug: "audio-recording", version: 1, acceptedAt: "2026-05-01T09:00:00.000Z", revokedAt: null },
      {
        slug: "ai-processing",
        version: 2,
        acceptedAt: "2026-05-01T09:00:00.000Z",
        revokedAt: "2026-06-01T09:00:00.000Z",
      },
    ]);
  });
});

describe("export file name", () => {
  it("is recognizable in a downloads folder", () => {
    expect(exportFileName("Márcia da Silva", "pdf", new Date("2026-08-07T12:00:00.000Z"))).toBe(
      "prontuario-marcia-da-silva-2026-08-07.pdf",
    );
  });

  it("survives a name that leaves nothing to slugify", () => {
    expect(exportFileName("!!!", "json", new Date("2026-08-07T12:00:00.000Z"))).toBe(
      "prontuario-paciente-2026-08-07.json",
    );
  });
});
