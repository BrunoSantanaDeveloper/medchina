// Deliberately NOT `server-only` — same reason as plan-document.tsx: the marker
// forces the "react-server" condition and breaks @react-pdf's reconciler. React
// is imported explicitly because JSX here compiles with the classic runtime
// outside the Next/SWC pipeline.
import React from "react";

import type { IssueContext } from "@flyee/documents";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * The receituário as a signed, QR-verifiable PDF (PRD §9.8) — deliberately a
 * LETTERHEAD document: the clinic and the professional frame the page, and the
 * body is nothing but the free text she wrote. No structured sections, no
 * version chrome — the professional's own words, her signature, and the QR
 * proof in the footer. A SNAPSHOT of what was validated, independent of later
 * edits.
 */

const ACCENT = "#177c81";
const INK = "#1a1a1a";
const MUTED = "#5c5c5c";
const HAIRLINE = "#d8d8d8";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 84,
    paddingHorizontal: 56,
    fontSize: 11,
    color: INK,
    fontFamily: "Helvetica",
    lineHeight: 1.6,
  },
  // Letterhead: the clinic is the page's identity.
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    paddingBottom: 10,
    marginBottom: 6,
  },
  org: { fontSize: 16, fontFamily: "Helvetica-Bold", color: ACCENT },
  docKind: { fontSize: 9, color: MUTED, marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  headerRight: { textAlign: "right", fontSize: 8, color: MUTED },
  professionalLine: { fontSize: 9, color: MUTED, marginBottom: 18 },
  metaRow: { flexDirection: "row", gap: 28, marginBottom: 22 },
  metaLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase" },
  metaValue: { fontSize: 11 },
  bodyLine: { fontSize: 11.5 },
  bodyGap: { height: 8 },
  signatureRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 40 },
  signatureBlock: { width: 250 },
  signatureLine: { borderTopWidth: 0.75, borderTopColor: INK, marginTop: 26, paddingTop: 5 },
  signatureName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  signatureMeta: { fontSize: 8, color: MUTED },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },
  qr: { width: 52, height: 52 },
  footerText: { fontSize: 7, color: MUTED, flex: 1, marginRight: 10 },
  footerCode: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
});

type Labels = (key: string) => string;

export type PrescriptionDocumentData = {
  orgName: string;
  patientName: string;
  professionalName: string;
  consultationDate: string;
  validatedAt: string;
  issuedAt: string;
  /** The ONLY body content: the free text the professional wrote. */
  description: string;
};

function PrescriptionDocument({ data, t, ctx }: { data: PrescriptionDocumentData; t: Labels; ctx: IssueContext }) {
  const lines = data.description.replace(/\r\n/g, "\n").split("\n");
  return (
    <Document title={`${t("prescription-title")} — ${data.patientName}`} author={data.professionalName}>
      <Page size="A4" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.org}>{data.orgName}</Text>
            <Text style={styles.docKind}>{t("prescription-title")}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text>
              {t("plan-doc-issued-at")}: {data.issuedAt}
            </Text>
          </View>
        </View>
        <Text style={styles.professionalLine}>{data.professionalName}</Text>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>{t("plan-doc-patient")}</Text>
            <Text style={styles.metaValue}>{data.patientName}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>{t("plan-doc-date")}</Text>
            <Text style={styles.metaValue}>{data.consultationDate}</Text>
          </View>
        </View>

        {/* The body IS her text — blank lines preserved as spacing. */}
        {lines.map((line, index) =>
          line.trim().length === 0 ? (
            <View key={index} style={styles.bodyGap} />
          ) : (
            <Text key={index} style={styles.bodyLine}>
              {line}
            </Text>
          ),
        )}

        {/* Never split the signature across pages. */}
        <View style={styles.signatureRow} wrap={false}>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureName}>{data.professionalName}</Text>
              <Text style={styles.signatureMeta}>{t("plan-doc-professional")}</Text>
              <Text style={styles.signatureMeta}>
                {t("plan-doc-validated-at")}: {data.validatedAt}
              </Text>
            </View>
          </View>
        </View>

        {/* QR + code: the authenticity proof @flyee/documents verifies. */}
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

export async function renderPrescriptionPdf(
  data: PrescriptionDocumentData,
  t: Labels,
  ctx: IssueContext,
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<PrescriptionDocument data={data} t={t} ctx={ctx} />);
  return new Uint8Array(buffer);
}
