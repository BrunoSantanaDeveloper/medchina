// Deliberately NOT `server-only` — same constraint as plan-document.tsx: that
// marker forces the "react-server" condition, which resolves React to the RSC
// build and breaks @react-pdf's reconciler. React is imported explicitly
// because JSX here compiles with the classic runtime outside Next/SWC.
import React from "react";

import type { GuidanceSection } from "@/lib/home-guidance";
import type { IssueContext } from "@flyee/documents";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * "Orientações para casa" as a QR-verifiable PDF (PRD §9.8) — the second
 * deliverable a validated plan produces, and the one the PATIENT actually
 * reads.
 *
 * Where the therapeutic plan is a clinical document (points, meridians,
 * strategy, signature), this is a handout: short, plain, and only what she has
 * to do. `lib/home-guidance.ts` decides what belongs here; this renders it.
 *
 * Two deliberate differences from the plan PDF. There is no signature block —
 * this is instruction, not prescription, and a signature would invite reading
 * it as one. And the practitioner's contact line sits at the bottom, because
 * the most common thing a patient does with a handout is wonder whom to ask.
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
    // Roomier than the clinical document: this one is read at home, possibly
    // by someone who is tired or unwell.
    lineHeight: 1.6,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    paddingBottom: 10,
    marginBottom: 18,
  },
  org: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ACCENT },
  docKind: { fontSize: 9, color: MUTED, marginTop: 2 },
  headerRight: { textAlign: "right", fontSize: 8, color: MUTED },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  intro: { fontSize: 10, color: MUTED, marginBottom: 16 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    marginBottom: 4,
  },
  text: { fontSize: 11 },
  listItem: { fontSize: 11, marginLeft: 10, marginBottom: 1 },
  contact: {
    marginTop: 18,
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
    fontSize: 9,
    color: MUTED,
  },
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

export type HomeGuidanceDocumentData = {
  orgName: string;
  patientName: string;
  professionalName: string;
  consultationDate: string;
  version: number;
  issuedAt: string;
  sections: GuidanceSection[];
};

function HomeGuidanceDocument({ data, t, ctx }: { data: HomeGuidanceDocumentData; t: Labels; ctx: IssueContext }) {
  return (
    <Document title={t("guidance-title")} author={data.professionalName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.org}>{data.orgName}</Text>
            <Text style={styles.docKind}>{t("guidance-title")}</Text>
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

        <Text style={styles.title}>{t("guidance-title")}</Text>
        <Text style={styles.intro}>
          {data.patientName} · {data.consultationDate}
        </Text>

        {data.sections.map((section, index) => (
          <View key={index} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{t(section.label)}</Text>
            {section.text ? <Text style={styles.text}>{section.text}</Text> : null}
            {section.items?.map((item, itemIndex) => (
              <Text key={itemIndex} style={styles.listItem}>
                • {item}
              </Text>
            ))}
          </View>
        ))}

        {/* Whom to ask — the question a handout most often raises. Composed
            here rather than interpolated so `Labels` stays a plain lookup, as
            in the plan renderer. */}
        <Text style={styles.contact}>
          {t("guidance-contact")} {data.professionalName}
        </Text>

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

export async function renderHomeGuidancePdf(
  data: HomeGuidanceDocumentData,
  t: Labels,
  ctx: IssueContext,
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<HomeGuidanceDocument data={data} t={t} ctx={ctx} />);
  return new Uint8Array(buffer);
}
