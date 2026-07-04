import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export type ContactFormEmailProps = {
  name: string;
  email: string;
  message: string;
};

/**
 * Internal notification for a public contact-form submission. Inline styles
 * only — email clients ignore stylesheets, so design tokens cannot be
 * consumed here directly; keep values aligned with packages/design-tokens.
 */
export default function ContactFormEmail({ name, email, message }: ContactFormEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New contact form message from {name}</Preview>
      <Body style={{ backgroundColor: "#fafafa", fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 16, margin: "40px auto", maxWidth: 480, padding: 32 }}>
          <Heading as="h2" style={{ color: "#4d4d4d", fontSize: 20, marginBottom: 8 }}>
            New contact form message
          </Heading>
          <Text style={{ color: "#4d4d4d", fontSize: 14, lineHeight: "22px" }}>
            <strong>{name}</strong> ({email}) wrote:
          </Text>
          <Text style={{ color: "#4d4d4d", fontSize: 14, lineHeight: "22px", whiteSpace: "pre-wrap" }}>{message}</Text>
          <Hr style={{ borderColor: "#e8e8e8", margin: "24px 0" }} />
          <Text style={{ color: "#999999", fontSize: 12 }}>Reply directly to this email to answer the sender.</Text>
        </Container>
      </Body>
    </Html>
  );
}
