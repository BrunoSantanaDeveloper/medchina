import "server-only";

import type { IssueContext } from "@flyee/documents";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * The therapeutic plan as a signed, QR-verifiable PDF (PRD §9.8) — the
 * deliverable a VALIDATED plan becomes. Rendering is pluggable in
 * @flyee/documents; this is MedChina's renderer for the "therapeutic-plan"
 * kind.
 *
 * Pure and server-only: it receives the plan snapshot, a label lookup (so every
 * string stays in the i18n catalog, resolved by the route) and the verification
 * context (QR + code) that @flyee/documents prints, and returns the bytes. The
 * package then hashes and stores them.
 *
 * The document is a SNAPSHOT: it renders what was validated, independent of any
 * later edit to the plan row — which is the point of an issued document.
 *
 * @react-pdf ships the 14 standard PDF fonts (Helvetica here); no external font
 * is fetched, which keeps issuance self-contained on the serverless runtime.
 */

// A restrained document palette. A PDF cannot read the CSS design tokens, so
// these are literals by necessity; the accent is the brand teal.
const ACCENT = "#177c81";
const INK = "#1a1a1a";
const MUTED = "#5c5c5c";
const HAIRLINE = "#d8d8d8";
const AMBER_BG = "#fbf3e6";
const AMBER_INK = "#8a5a12";

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
  fieldLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", marginTop: 6 },
  fieldValue: { fontSize: 10 },
  listItem: { fontSize: 10, marginLeft: 8 },
  safety: { backgroundColor: AMBER_BG, borderRadius: 4, padding: 10, marginBottom: 14 },
  safetyTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: AMBER_INK, marginBottom: 4 },
  safetyItem: { fontSize: 9, color: AMBER_INK, marginBottom: 2 },
  disclaimer: { fontSize: 8, color: MUTED, fontStyle: "italic", marginTop: 6 },
  signatureRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28 },
  signatureBlock: { width: 240 },
  signatureLine: { borderTopWidth: 0.75, borderTopColor: INK, marginTop: 30, paddingTop: 4 },
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

export type PlanDocumentData = {
  orgName: string;
  patientName: string;
  professionalName: string;
  consultationDate: string;
  validatedAt: string;
  version: number;
  issuedAt: string;
  objective: string;
  modalities: { slug: string; fields: { label: string; value: string; list?: string[] }[] }[];
  safetyFlags: { category: string; matchedText: string }[];
};

function Field({ label, value, list }: { label: string; value?: string; list?: string[] }) {
  if (list) {
    if (list.length === 0) return null;
    return (
      <View>
        <Text style={styles.fieldLabel}>{label}</Text>
        {list.map((item, index) => (
          <Text key={index} style={styles.listItem}>
            • {item}
          </Text>
        ))}
      </View>
    );
  }
  if (!value) return null;
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function PlanDocument({ data, t, ctx }: { data: PlanDocumentData; t: Labels; ctx: IssueContext }) {
  return (
    <Document title={`${t("plan-title")} — ${data.patientName}`} author={data.professionalName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.org}>{data.orgName}</Text>
            <Text style={styles.docKind}>{t("plan-title")}</Text>
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

        <Text style={styles.title}>{t("plan-title")}</Text>
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

        {/* Contraindications first, never hidden (PRD §10.10). */}
        {data.safetyFlags.length > 0 && (
          <View style={styles.safety}>
            <Text style={styles.safetyTitle}>{t("plan-safety-title")}</Text>
            {data.safetyFlags.map((flag, index) => (
              <Text key={index} style={styles.safetyItem}>
                • {t(`plan-safety-${flag.category}`)}: {flag.matchedText}
              </Text>
            ))}
          </View>
        )}

        {data.objective ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("plan-objective")}</Text>
            <Text style={styles.fieldValue}>{data.objective}</Text>
          </View>
        ) : null}

        {data.modalities.map((modality) => (
          <View key={modality.slug} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{t(`plan-modality-${modality.slug}`)}</Text>
            {modality.fields.map((field, index) => (
              <Field key={index} label={field.label} value={field.value} list={field.list} />
            ))}
          </View>
        ))}

        <Text style={styles.disclaimer}>{t("plan-disclaimer")}</Text>

        <View style={styles.signatureRow}>
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

export async function renderPlanPdf(data: PlanDocumentData, t: Labels, ctx: IssueContext): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<PlanDocument data={data} t={t} ctx={ctx} />);
  return new Uint8Array(buffer);
}
