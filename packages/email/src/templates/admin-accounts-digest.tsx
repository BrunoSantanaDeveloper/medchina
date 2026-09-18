import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";

export type AdminAccountsDigestEmailProps = {
  /** One line naming what needs a human today. */
  headline: string;
  /** At most a handful: the digest points, the console decides. */
  items: { account: string; detail: string }[];
  /** Deep link into the console, already filtered to the urgent group. */
  appUrl: string;
};

/**
 * The platform operator's daily digest of accounts that need attention.
 *
 * The console answers "which account needs me today?" — but only for someone
 * who opens it. A trial ends on its own schedule and an overdue payment does
 * not wait for anyone's routine, so the answer has to travel to the operator
 * instead. It is sent only when there IS something (no "all clear" mail), and
 * only once per day per operator.
 *
 * Operational, not marketing: it goes to the platform's own staff, so it
 * carries no unsubscribe.
 *
 * Inline styles only — email clients ignore stylesheets, so design tokens
 * cannot be consumed here; keep values aligned with packages/design-tokens by
 * hand.
 */
export default function AdminAccountsDigestEmail({ headline, items, appUrl }: AdminAccountsDigestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{headline}</Preview>
      <Body style={{ backgroundColor: "#faf8f5", fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>
        <Container
          style={{ backgroundColor: "#ffffff", borderRadius: 16, margin: "40px auto", maxWidth: 520, padding: 32 }}
        >
          <Heading as="h2" style={{ color: "#3d3d3d", fontSize: 20, marginBottom: 8 }}>
            {headline}
          </Heading>
          <Text style={{ color: "#4d4d4d", fontSize: 14, lineHeight: "22px" }}>
            Contas que pedem uma decisão hoje:
          </Text>
          <Section style={{ margin: "16px 0" }}>
            {items.map((item) => (
              <Text key={`${item.account}-${item.detail}`} style={{ color: "#3d3d3d", fontSize: 14, margin: "0 0 8px" }}>
                <strong>{item.account}</strong>
                <br />
                <span style={{ color: "#777777" }}>{item.detail}</span>
              </Text>
            ))}
          </Section>
          <Section style={{ margin: "24px 0", textAlign: "center" }}>
            <Button
              href={appUrl}
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
              Abrir o painel de contas
            </Button>
          </Section>
          <Hr style={{ borderColor: "#e8e8e8", margin: "24px 0" }} />
          <Text style={{ color: "#999999", fontSize: 12, lineHeight: "18px" }}>
            Aviso interno da plataforma, enviado uma vez por dia e só quando há algo a decidir.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
