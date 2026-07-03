import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";

export type OrgInviteEmailProps = {
  orgName: string;
  role: string;
  inviteUrl: string;
  invitedBy?: string;
};

/**
 * Invitation to join an organization. Inline styles only — email clients
 * ignore stylesheets, so design tokens cannot be consumed here directly;
 * keep values aligned with packages/design-tokens by hand.
 */
export default function OrgInviteEmail({ orgName, role, inviteUrl, invitedBy }: OrgInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You have been invited to join {orgName}</Preview>
      <Body style={{ backgroundColor: "#fafafa", fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 16, margin: "40px auto", maxWidth: 480, padding: 32 }}>
          <Heading as="h2" style={{ color: "#4d4d4d", fontSize: 20, marginBottom: 8 }}>
            Join {orgName}
          </Heading>
          <Text style={{ color: "#4d4d4d", fontSize: 14, lineHeight: "22px" }}>
            {invitedBy ? `${invitedBy} has` : "You have been"} invited you to join <strong>{orgName}</strong> as{" "}
            <strong>{role}</strong>.
          </Text>
          <Section style={{ margin: "24px 0", textAlign: "center" }}>
            <Button
              href={inviteUrl}
              style={{
                backgroundColor: "#00b8e0",
                borderRadius: 12,
                color: "#ffffff",
                display: "inline-block",
                fontSize: 14,
                fontWeight: 600,
                padding: "12px 24px",
                textDecoration: "none",
              }}
            >
              Accept invite
            </Button>
          </Section>
          <Text style={{ color: "#999999", fontSize: 12, lineHeight: "18px" }}>
            Or paste this link into your browser: {inviteUrl}
          </Text>
          <Hr style={{ borderColor: "#e8e8e8", margin: "24px 0" }} />
          <Text style={{ color: "#999999", fontSize: 12 }}>
            If you were not expecting this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
