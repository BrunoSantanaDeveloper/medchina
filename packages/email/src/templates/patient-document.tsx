import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";

export type PatientDocumentEmailProps = {
  /** The tokenized link to /documento — the ONLY thing that travels. */
  url: string;
  practiceName: string;
  patientFirstName?: string;
};

/**
 * Tells a PATIENT that a document is waiting for her.
 *
 * Deliberately carries no clinical content — not the treatment, not the
 * condition, not even the document type beyond "documento". An inbox is not a
 * private place: it syncs to phones, backs up to other people's clouds and is
 * read over shoulders. The document itself lives behind an expiring link.
 *
 * Written in pt-BR: it addresses the practitioner's PATIENT, who never chose a
 * locale in this product, and the practice is Brazilian by design.
 *
 * Inline styles only — email clients ignore stylesheets, so design tokens
 * cannot be consumed here; keep values aligned with packages/design-tokens by
 * hand (teal #177c81 is the brand primary).
 */
export default function PatientDocumentEmail({ url, practiceName, patientFirstName }: PatientDocumentEmailProps) {
  const greeting = patientFirstName ? `Olá, ${patientFirstName}!` : "Olá!";
  return (
    <Html>
      <Head />
      <Preview>Seu documento está disponível</Preview>
      <Body style={{ backgroundColor: "#fafafa", fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>
        <Container
          style={{ backgroundColor: "#ffffff", borderRadius: 16, margin: "40px auto", maxWidth: 480, padding: 32 }}
        >
          <Heading as="h2" style={{ color: "#4d4d4d", fontSize: 20, marginBottom: 8 }}>
            Seu documento está disponível
          </Heading>
          <Text style={{ color: "#4d4d4d", fontSize: 14, lineHeight: "22px" }}>
            {greeting} {practiceName ? <strong>{practiceName}</strong> : "Sua profissional"} disponibilizou um documento
            para você.
          </Text>
          <Section style={{ margin: "24px 0", textAlign: "center" }}>
            <Button
              href={url}
              style={{
                backgroundColor: "#177c81",
                borderRadius: 12,
                color: "#ffffff",
                display: "inline-block",
                fontSize: 14,
                fontWeight: 600,
                padding: "12px 24px",
                textDecoration: "none",
              }}
            >
              Abrir documento
            </Button>
          </Section>
          <Text style={{ color: "#999999", fontSize: 12, lineHeight: "18px" }}>
            Ou copie este endereço no navegador: {url}
          </Text>
          <Hr style={{ borderColor: "#e8e8e8", margin: "24px 0" }} />
          <Text style={{ color: "#999999", fontSize: 12, lineHeight: "18px" }}>
            O link é pessoal e expira em 7 dias. Se você não esperava esta mensagem, pode ignorá-la — nenhum dado de
            saúde é enviado por e-mail.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
