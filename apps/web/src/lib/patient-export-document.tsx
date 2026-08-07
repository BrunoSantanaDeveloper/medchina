// Deliberately NOT `server-only` — same constraint as the other renderers:
// that marker forces the "react-server" condition, which resolves React to the
// RSC build and breaks @react-pdf's reconciler. React is imported explicitly
// because JSX here compiles with the classic runtime outside Next/SWC.
import React from "react";

import type { ExportConsultation, PatientExport } from "@/lib/patient-export";
import { PDF_ACCENT, PDF_HAIRLINE, PDF_INK, PDF_MUTED } from "@/lib/pdf-theme";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * The readable half of a patient export (docs/IMPORT-EXPORT.md §7).
 *
 * The JSON is for the system she moves to; this is for a person — her, a
 * colleague taking over the case, or the patient herself. So it reads as a
 * chart: identification, then one section per consultation in the order they
 * happened, with the anamnesis grouped by block exactly as she filled it.
 *
 * Every label arrives resolved from the route, so this file stays i18n-clean.
 */

export type PatientExportLabels = {
  title: string;
  generatedAt: string;
  patientData: string;
  birthDate: string;
  document: string;
  phone: string;
  email: string;
  notes: string;
  alerts: string;
  consultations: string;
  noConsultations: string;
  chiefComplaint: string;
  summary: string;
  addenda: string;
  hypotheses: string;
  plan: string;
  attachments: string;
  documents: string;
  consents: string;
  legacy: string;
  documentRevoked: string;
  scopeNote: string;
  /** Consultation status -> her word for it. */
  statuses: Record<string, string>;
  /** Anamnesis block key -> title. */
  blocks: Record<string, string>;
  /** `${blockKey}.${fieldKey}` -> field label. */
  fields: Record<string, string>;
  /** Answer source -> "informado pela paciente", "observação da profissional"… */
  sources: Record<string, string>;
  consentStates: { active: string; revoked: string };
  page: (current: number, total: number) => string;
  formatDate: (iso: string) => string;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 64,
    paddingHorizontal: 44,
    fontSize: 10,
    color: PDF_INK,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: PDF_ACCENT,
    paddingBottom: 8,
    marginBottom: 18,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: PDF_ACCENT },
  headerMeta: { fontSize: 8, color: PDF_MUTED, textAlign: "right" },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: PDF_ACCENT,
    marginTop: 16,
    marginBottom: 6,
  },
  patientName: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 108, color: PDF_MUTED },
  value: { flex: 1 },
  alert: { fontFamily: "Helvetica-Bold" },
  consultation: {
    borderTopWidth: 0.75,
    borderTopColor: PDF_HAIRLINE,
    paddingTop: 8,
    marginTop: 12,
  },
  consultationHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  consultationDate: { fontFamily: "Helvetica-Bold", fontSize: 11 },
  status: { fontSize: 8, color: PDF_MUTED },
  blockTitle: { fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 },
  answerRow: { flexDirection: "row", marginBottom: 1 },
  answerLabel: { width: 132, color: PDF_MUTED },
  answerValue: { flex: 1 },
  answerSource: { color: PDF_MUTED, fontSize: 8 },
  paragraph: { marginBottom: 4 },
  subtle: { color: PDF_MUTED },
  note: { fontSize: 8, color: PDF_MUTED, marginTop: 14 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: PDF_HAIRLINE,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: PDF_MUTED,
  },
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function ConsultationSection({
  consultation,
  labels,
}: {
  consultation: ExportConsultation;
  labels: PatientExportLabels;
}) {
  const when = consultation.startedAt ?? consultation.scheduledFor;
  // Answers keep the block order they were recorded in; grouping them here is
  // what makes an export read like the anamnesis instead of a key-value dump.
  const blocks = consultation.answers.reduce<Record<string, ExportConsultation["answers"]>>((groups, answer) => {
    (groups[answer.blockKey] ??= []).push(answer);
    return groups;
  }, {});

  return (
    <View style={styles.consultation} wrap={false}>
      <View style={styles.consultationHead}>
        <Text style={styles.consultationDate}>{when ? labels.formatDate(when) : "—"}</Text>
        <Text style={styles.status}>{labels.statuses[consultation.status] ?? consultation.status}</Text>
      </View>

      {consultation.chiefComplaint && <Field label={labels.chiefComplaint} value={consultation.chiefComplaint} />}
      {consultation.summary && <Field label={labels.summary} value={consultation.summary} />}

      {consultation.legacy && (
        <View>
          <Text style={styles.blockTitle}>
            {labels.legacy}
            {consultation.legacy.source ? ` — ${consultation.legacy.source}` : ""}
          </Text>
          <Text style={styles.paragraph}>{consultation.legacy.body}</Text>
        </View>
      )}

      {Object.entries(blocks).map(([blockKey, answers]) => (
        <View key={blockKey}>
          <Text style={styles.blockTitle}>{labels.blocks[blockKey] ?? blockKey}</Text>
          {answers.map((answer, index) => (
            <View key={`${answer.fieldKey}-${index}`} style={styles.answerRow}>
              <Text style={styles.answerLabel}>
                {labels.fields[`${blockKey}.${answer.fieldKey}`] ?? answer.fieldKey}
              </Text>
              <Text style={styles.answerValue}>
                {answer.value}
                {/* Provenance travels with the value: a chart must never lose
                    the difference between what she observed and what the AI
                    drafted from the recording (PRD §10.3). */}
                {answer.source !== "professional" && (
                  <Text style={styles.answerSource}> ({labels.sources[answer.source] ?? answer.source})</Text>
                )}
              </Text>
            </View>
          ))}
        </View>
      ))}

      {consultation.addenda.length > 0 && (
        <View>
          <Text style={styles.blockTitle}>{labels.addenda}</Text>
          {consultation.addenda.map((addendum, index) => (
            <Text key={index} style={styles.paragraph}>
              {labels.formatDate(addendum.createdAt)} — {addendum.body}
              {addendum.reason ? ` (${addendum.reason})` : ""}
            </Text>
          ))}
        </View>
      )}

      {consultation.hypotheses.length > 0 && (
        <View>
          <Text style={styles.blockTitle}>{labels.hypotheses}</Text>
          {consultation.hypotheses.map((hypothesis, index) => (
            <Text key={index} style={styles.paragraph}>
              {hypothesis.pattern}
              {hypothesis.correspondence ? ` — ${hypothesis.correspondence}` : ""} ({hypothesis.status})
            </Text>
          ))}
        </View>
      )}

      {consultation.plan && (
        <View>
          <Text style={styles.blockTitle}>{labels.plan}</Text>
          <Text style={styles.paragraph}>
            {consultation.plan.modalities.join(", ") || "—"} ({consultation.plan.status})
          </Text>
        </View>
      )}

      {consultation.attachments.length > 0 && (
        <Field
          label={labels.attachments}
          value={consultation.attachments
            .map((attachment) => `${attachment.caption ?? attachment.kind} (${attachment.mime})`)
            .join("; ")}
        />
      )}

      {consultation.documents.length > 0 && (
        <Field
          label={labels.documents}
          value={consultation.documents
            .map(
              (document) =>
                `${document.title ?? document.kind}${document.version ? ` v${document.version}` : ""}` +
                // A superseded document stays listed: it was handed to someone.
                (document.status === "revoked" ? ` (${labels.documentRevoked})` : ""),
            )
            .join("; ")}
        />
      )}
    </View>
  );
}

export function PatientExportDocument({ data, labels }: { data: PatientExport; labels: PatientExportLabels }) {
  const { patient } = data;

  return (
    <Document title={`${labels.title} — ${patient.fullName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow} fixed>
          <Text style={styles.title}>{labels.title}</Text>
          <Text style={styles.headerMeta}>{labels.generatedAt}</Text>
        </View>

        <Text style={styles.patientName}>{patient.fullName}</Text>
        <Text style={styles.sectionTitle}>{labels.patientData}</Text>
        {patient.birthDate && <Field label={labels.birthDate} value={labels.formatDate(patient.birthDate)} />}
        {patient.document && <Field label={labels.document} value={patient.document} />}
        {patient.phone && <Field label={labels.phone} value={patient.phone} />}
        {patient.email && <Field label={labels.email} value={patient.email} />}
        {patient.notes && <Field label={labels.notes} value={patient.notes} />}
        {patient.alerts.length > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>{labels.alerts}</Text>
            <Text style={[styles.value, styles.alert]}>{patient.alerts.map((alert) => alert.label).join(" · ")}</Text>
          </View>
        )}

        {data.consents.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>{labels.consents}</Text>
            {data.consents.map((consent, index) => (
              <Field
                key={index}
                label={consent.slug}
                value={`${labels.formatDate(consent.acceptedAt)} — ${
                  consent.revokedAt
                    ? `${labels.consentStates.revoked} ${labels.formatDate(consent.revokedAt)}`
                    : labels.consentStates.active
                }`}
              />
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>{labels.consultations}</Text>
        {data.consultations.length === 0 ? (
          <Text style={styles.subtle}>{labels.noConsultations}</Text>
        ) : (
          data.consultations.map((consultation) => (
            <ConsultationSection key={consultation.id} consultation={consultation} labels={labels} />
          ))
        )}

        {/* What this file does NOT carry, stated inside the file — someone
            reading it a year from now cannot ask us. */}
        <Text style={styles.note}>{labels.scopeNote}</Text>

        <View style={styles.footer} fixed>
          <Text>{patient.fullName}</Text>
          <Text render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages)} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPatientExportPdf(data: PatientExport, labels: PatientExportLabels): Promise<Buffer> {
  return renderToBuffer(<PatientExportDocument data={data} labels={labels} />);
}
