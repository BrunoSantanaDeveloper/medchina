// Deliberately NOT `server-only` — same constraint as the other renderers:
// that marker forces the "react-server" condition, which resolves React to the
// RSC build and breaks @react-pdf's reconciler. React is imported explicitly
// because JSX here compiles with the classic runtime outside Next/SWC.
import React from "react";

import type { IssueContext } from "@flyee/documents";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Declaração de comparecimento (PRD §9.8) — the note a patient takes to her
 * employer or school to justify the hours she was in treatment.
 *
 * The most FREQUENT document in a real practice, and the one whose reader is
 * neither the patient nor the professional: it is written for a third party
 * who must be able to trust it without knowing anything about the treatment.
 *
 * So it states exactly three things — that she attended, when, and for how
 * long — and deliberately NOTHING clinical. No complaint, no diagnosis, no
 * technique, no plan: an employer has no business learning that someone is
 * treating insomnia, and the QR proves authenticity without exposing any of
 * it (the public /verify page is PHI-thin by construction, migration 0060).
 */

const ACCENT = "#177c81";
const INK = "#1a1a1a";
const MUTED = "#5c5c5c";
const HAIRLINE = "#d8d8d8";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 72,
    paddingHorizontal: 48,
    fontSize: 11,
    color: INK,
    fontFamily: "Helvetica",
    lineHeight: 1.6,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    paddingBottom: 10,
    marginBottom: 24,
  },
  org: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ACCENT },
  docKind: { fontSize: 9, color: MUTED, marginTop: 2 },
  headerRight: { textAlign: "right", fontSize: 8, color: MUTED },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 18, textAlign: "center" },
  body: { fontSize: 12, lineHeight: 1.8, marginBottom: 18 },
  strong: { fontFamily: "Helvetica-Bold" },
  note: { fontSize: 9, color: MUTED, marginTop: 8 },
  signatureRow: { marginTop: 42, alignItems: "center" },
  signatureBlock: { width: 280 },
  signatureLine: { borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4, alignItems: "center" },
  signatureName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  signatureMeta: { fontSize: 8, color: MUTED },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },
  qr: { width: 56, height: 56 },
  footerText: { fontSize: 7, color: MUTED, flex: 1, marginRight: 10 },
  footerCode: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
});

type Labels = (key: string) => string;

export type AttendanceDocumentData = {
  orgName: string;
  patientName: string;
  professionalName: string;
  /** Already formatted in the practice's timezone and the app's locale. */
  attendanceDate: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  version: number;
  issuedAt: string;
};

function AttendanceDocument({ data, t, ctx }: { data: AttendanceDocumentData; t: Labels; ctx: IssueContext }) {
  return (
    <Document title={t("attendance-title")} author={data.professionalName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.org}>{data.orgName}</Text>
            <Text style={styles.docKind}>{t("attendance-title")}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text>
              {t("plan-doc-issued-at")}: {data.issuedAt}
            </Text>
            <Text>
              {t("plan-doc-version")} {data.version}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{t("attendance-title")}</Text>

        {/* One sentence, so a third party can read it at a glance. The times
            are the record's own (started_at / finalized_at), never typed. */}
        <Text style={styles.body}>
          {t("attendance-body-1")} <Text style={styles.strong}>{data.patientName}</Text> {t("attendance-body-2")}{" "}
          <Text style={styles.strong}>{data.attendanceDate}</Text>
          {data.endTime
            ? ` ${t("attendance-body-period")} ${data.startTime} ${t("attendance-body-to")} ${data.endTime}`
            : ` ${t("attendance-body-at")} ${data.startTime}`}
          {data.durationMinutes ? ` (${data.durationMinutes} ${t("attendance-minutes")})` : ""}.
        </Text>

        {/* Says what it deliberately does NOT say, so nobody reads the absence
            of clinical detail as an omission. */}
        <Text style={styles.note}>{t("attendance-privacy-note")}</Text>

        <View style={styles.signatureRow}>
          <View style={styles.signatureBlock}>
            <View style={{ height: 28 }} />
            <View style={styles.signatureLine}>
              <Text style={styles.signatureName}>{data.professionalName}</Text>
              <Text style={styles.signatureMeta}>{t("plan-doc-professional")}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Image style={styles.qr} src={ctx.qrDataUrl} />
          <Text style={styles.footerText}>
            {t("plan-doc-verify")} {ctx.verifyUrl}
          </Text>
          <Text style={styles.footerCode}>{ctx.verifyCode}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderAttendancePdf(
  data: AttendanceDocumentData,
  t: Labels,
  ctx: IssueContext,
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<AttendanceDocument data={data} t={t} ctx={ctx} />);
  return new Uint8Array(buffer);
}
