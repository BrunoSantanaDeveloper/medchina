// Deliberately NOT `server-only` — same reason as plan-document.tsx: the marker
// forces the "react-server" condition and breaks @react-pdf's reconciler. React
// is imported explicitly because JSX here compiles with the classic runtime
// outside the Next/SWC pipeline.
import React from "react";

import type { IssueContext } from "@flyee/documents";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * The receituário as a signed, QR-verifiable PDF (PRD §9.8) — what a VALIDATED
 * prescription becomes. Professional-authored (the AI never prescribes). Pure
 * and server-side: it receives the reserved snapshot, an i18n label lookup and
 * the verification context, and returns the bytes for @flyee/documents to hash
 * and store. A SNAPSHOT: it renders what was validated, independent of later
 * edits.
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
    fontSize: 10,
    color: INK,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    paddingBottom: 10,
    marginBottom: 16,
  },
  org: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ACCENT },
  docKind: { fontSize: 9, color: MUTED, marginTop: 2 },
  headerRight: { textAlign: "right", fontSize: 8, color: MUTED },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 24, marginBottom: 14 },
  metaLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase" },
  metaValue: { fontSize: 10 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    paddingBottom: 3,
  },
  itemRow: { flexDirection: "row", marginBottom: 3 },
  itemName: { fontSize: 10, flex: 1 },
  itemAmount: { fontSize: 10, fontFamily: "Helvetica-Bold", marginLeft: 10 },
  itemNotes: { fontSize: 9, color: MUTED, marginLeft: 8 },
  fieldValue: { fontSize: 10 },
  disclaimer: { fontSize: 8, color: MUTED, fontStyle: "italic", marginTop: 6 },
  signatureRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 16 },
  signatureBlock: { width: 240 },
  signatureLine: { borderTopWidth: 0.75, borderTopColor: INK, marginTop: 22, paddingTop: 4 },
  signatureName: { fontSize: 10, fontFamily: "Helvetica-Bold" },
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

export type PrescriptionDocumentData = {
  orgName: string;
  patientName: string;
  professionalName: string;
  consultationDate: string;
  validatedAt: string;
  version: number;
  issuedAt: string;
  /** Localized kind label ("Fitoterápico…" / "Receituário genérico"), from the route. */
  kindLabel: string;
  title: string;
  items: { name: string; amount: string; notes: string }[];
  preparation: string;
  posology: string;
  notes: string;
};

function Section({ title, value }: { title: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function PrescriptionDocument({ data, t, ctx }: { data: PrescriptionDocumentData; t: Labels; ctx: IssueContext }) {
  return (
    <Document title={`${t("prescription-title")} — ${data.patientName}`} author={data.professionalName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.org}>{data.orgName}</Text>
            <Text style={styles.docKind}>{data.kindLabel}</Text>
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

        <Text style={styles.title}>{data.title || data.kindLabel}</Text>
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

        {data.items.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("prescription-items")}</Text>
            {data.items.map((item, index) => (
              <View key={index} wrap={false}>
                <View style={styles.itemRow}>
                  <Text style={styles.itemName}>• {item.name}</Text>
                  {item.amount ? <Text style={styles.itemAmount}>{item.amount}</Text> : null}
                </View>
                {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
              </View>
            ))}
          </View>
        )}

        <Section title={t("prescription-preparation")} value={data.preparation} />
        <Section title={t("prescription-posology")} value={data.posology} />
        <Section title={t("prescription-notes")} value={data.notes} />

        <Text style={styles.disclaimer}>{t("prescription-disclaimer")}</Text>

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
